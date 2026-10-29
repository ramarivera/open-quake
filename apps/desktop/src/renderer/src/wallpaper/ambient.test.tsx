// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { mount } from "../../test/dom";
import { AmbientSettings } from "./AmbientSettings";
import { readAmbientStyle } from "./ambient-appearance";
import {
	idleAmbientAudio,
	observeAmbientAudio,
	spectrumEnergy,
} from "./ambient-audio";
import { WallpaperCanvas } from "./WallpaperCanvas";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
	window.localStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
const snapshot: WallpaperSnapshot = {
	saved: {
		version: 1,
		serial: "A",
		revision: 3,
		settings: defaultWallpaper,
		clock: defaultClockTile,
	},
	asset: { _tag: "empty" },
	clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
	recovered: false,
	normalizedFileUrl: false,
	deviceDelivery: "unverified",
};

it("applies a per-device style to both consumers, preserves media, resets and unsubscribes", async () => {
	const before = JSON.stringify(snapshot);
	const mounted = await mount(
		<>
			<AmbientSettings serial="A" />
			<WallpaperCanvas snapshot={snapshot} />
			<WallpaperCanvas snapshot={snapshot} />
		</>,
	);
	close = mounted.close;
	const select = mounted.host.querySelector("select");
	if (!select) throw new Error("Missing style control");
	await act(async () => {
		select.value = "lava";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(mounted.host.querySelectorAll(".ambient-lava")).toHaveLength(2);
	expect(mounted.host.textContent).toContain("doesn't listen to other apps");
	expect(
		mounted.host.querySelector(".ambient-source")?.getAttribute("aria-label"),
	).toBe("Waiting for background media audio");
	expect(readAmbientStyle("A")).toBe("lava");
	expect(readAmbientStyle("B")).toBe("media");
	expect(JSON.stringify(snapshot)).toBe(before);
	await act(async () => {
		window.localStorage.clear();
		window.dispatchEvent(new StorageEvent("storage", { key: null }));
	});
	expect(mounted.host.querySelector(".ambient-art")).toBeNull();
	await mounted.render(
		<WallpaperCanvas
			snapshot={{
				...snapshot,
				saved: {
					...snapshot.saved,
					settings: { ...defaultWallpaper, isTransparent: true },
				},
			}}
		/>,
	);
	expect(mounted.host.querySelector("rect, image, video")).toBeNull();
});

it("rejects corrupt saved styles and makes storage failures visible without applying a different background", async () => {
	window.localStorage.setItem("open-quake.ambient.A", "<bad>");
	expect(readAmbientStyle("A")).toBe("media");
	const mounted = await mount(<AmbientSettings serial="A" />);
	close = mounted.close;
	vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
		throw new Error("full");
	});
	const select = mounted.host.querySelector("select");
	if (!select) throw new Error("Missing style control");
	await act(async () => {
		select.value = "contour";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	expect(select.value).toBe("media");
	expect(mounted.host.querySelector('[role="status"]')?.textContent).toContain(
		"couldn't be saved",
	);
});

it("maps real bass and treble to separate visual bands and treats silence honestly", () => {
	const bins = new Uint8Array(1024);
	expect(spectrumEnergy(bins, 48000, 2048)).toEqual({
		...idleAmbientAudio,
		state: "silent",
	});
	bins.fill(255, 1, 8);
	const bass = spectrumEnergy(bins, 48000, 2048);
	expect(bass.low).toBe(1);
	expect(bass.high).toBe(0);
	expect(bass.state).toBe("live");
	bins.fill(0);
	bins.fill(255, 86, 513);
	const treble = spectrumEnergy(bins, 48000, 2048);
	expect(treble.low).toBe(0);
	expect(treble.high).toBeGreaterThan(0.9);
});

it("owns capture tracks, analysis and frames, stops on pause and releases everything on disposal", async () => {
	const video = document.createElement("video");
	vi.spyOn(video, "paused", "get").mockReturnValue(false);
	vi.spyOn(document, "hidden", "get").mockReturnValue(false);
	const track = { stop: vi.fn() };
	Object.assign(video, {
		captureStream: () => ({
			getAudioTracks: () => [track],
			getTracks: () => [track],
		}),
	});
	const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
	const source = node(),
		sink = { ...node(), gain: { value: 1 } };
	const analyser = {
		...node(),
		fftSize: 2048,
		frequencyBinCount: 1024,
		getByteFrequencyData: (data: Uint8Array) => data.fill(160),
	};
	const shutdown = vi.fn(async () => {});
	vi.stubGlobal(
		"AudioContext",
		class {
			state = "running";
			sampleRate = 48000;
			destination = {};
			createMediaStreamSource = () => source;
			createAnalyser = () => analyser;
			createGain = () => sink;
			resume = async () => {};
			close = shutdown;
		},
	);
	let tick: FrameRequestCallback = () => {};
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			tick = callback;
			return 1;
		}),
	);
	const cancel = vi.fn();
	vi.stubGlobal("cancelAnimationFrame", cancel);
	const update = vi.fn();
	const stop = observeAmbientAudio(video, update);
	tick(100);
	expect(update).toHaveBeenLastCalledWith(
		expect.objectContaining({ state: "live" }),
	);
	expect(sink.gain.value).toBe(0);
	video.dispatchEvent(new Event("pause"));
	expect(track.stop).toHaveBeenCalledOnce();
	expect(shutdown).toHaveBeenCalledOnce();
	expect(update).toHaveBeenLastCalledWith(idleAmbientAudio);
	stop();
	const calls = update.mock.calls.length;
	video.dispatchEvent(new Event("playing"));
	tick(200);
	expect(update).toHaveBeenCalledTimes(calls);
	expect(cancel).toHaveBeenCalled();
});

it("reports unsupported media analysis and doesn't request microphone or system capture", () => {
	const video = document.createElement("video");
	vi.spyOn(video, "paused", "get").mockReturnValue(false);
	vi.spyOn(document, "hidden", "get").mockReturnValue(false);
	const update = vi.fn();
	const stop = observeAmbientAudio(video, update);
	expect(update).toHaveBeenLastCalledWith({
		...idleAmbientAudio,
		state: "unavailable",
	});
	stop();
});

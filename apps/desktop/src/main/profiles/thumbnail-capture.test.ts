// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import {
	stableThumbnailFrame,
	thumbnailCaptureMode,
	thumbnailDeadline,
	thumbnailInitialSweep,
	waitForThumbnailMedia,
} from "./thumbnail-capture";

afterEach(() => {
	document.body.replaceChildren();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("SCREEN-098 chooses background capture and explicit Linux startup policy", () => {
	for (const platform of ["darwin", "win32"] as const) {
		expect(thumbnailCaptureMode(platform)).toBe("hidden");
		expect(thumbnailInitialSweep(platform)).toBe(true);
		expect(thumbnailInitialSweep(platform, "off")).toBe(false);
	}
	expect(thumbnailCaptureMode("linux")).toBe("offscreen");
	expect(thumbnailCaptureMode("linux", "off")).toBe("unsupported");
	expect(thumbnailInitialSweep("linux")).toBe(false);
	expect(thumbnailInitialSweep("linux", "on")).toBe(true);
});
it("SCREEN-098 requires adjacent equal frames and stops after six changing frames", async () => {
	const frames = ["a", "b", "b"].map((value) => Buffer.from(value));
	const capture = vi.fn(
		async () => frames.shift() ?? Buffer.from("unexpected"),
	);
	const next = vi.fn(async () => {});
	expect(
		await stableThumbnailFrame(capture, next, new AbortController().signal),
	).toEqual(Buffer.from("b"));
	expect(capture).toHaveBeenCalledTimes(3);
	expect(next).toHaveBeenCalledTimes(2);
	let frame = 0;
	const unstable = vi.fn(async () => Buffer.from(String(frame++)));
	await expect(
		stableThumbnailFrame(unstable, next, new AbortController().signal),
	).rejects.toBeInstanceOf(ProfileThumbnailFailed);
	expect(unstable).toHaveBeenCalledTimes(6);
});
it("SCREEN-098 closes timed-out or cancelled capture owners without publishing late data", async () => {
	vi.useFakeTimers();
	const cancel = vi.fn();
	const controller = new AbortController();
	const pending = thumbnailDeadline(
		() => new Promise<string>(() => {}),
		8000,
		controller.signal,
		cancel,
	);
	const timeout = expect(pending).rejects.toMatchObject({
		_tag: "ProfileThumbnailFailed",
		code: "QUAKE.PROFILE.THUMBNAIL_FAILED",
	});
	await vi.advanceTimersByTimeAsync(8000);
	await timeout;
	expect(cancel).toHaveBeenCalledTimes(1);
	const stopped = thumbnailDeadline(
		() => new Promise<string>(() => {}),
		8000,
		controller.signal,
		cancel,
	);
	const aborted = expect(stopped).rejects.toBeInstanceOf(
		ProfileThumbnailFailed,
	);
	controller.abort();
	await aborted;
	expect(cancel).toHaveBeenCalledTimes(2);
	expect(vi.getTimerCount()).toBe(0);
});
it("SCREEN-098 waits for fonts, decoded images and a video frame before settling", async () => {
	const preview = document.createElement("div");
	preview.dataset.profileReady = "p";
	const image = document.createElement("img"),
		video = document.createElement("video");
	preview.append(image, video);
	document.body.append(preview);
	let fontsReady = () => {},
		imageReady = () => {};
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: {
			ready: new Promise<void>((resolve) => {
				fontsReady = resolve;
			}),
		},
	});
	Object.defineProperties(image, {
		complete: { value: true },
		naturalWidth: { value: 10 },
		decode: {
			value: () =>
				new Promise<void>((resolve) => {
					imageReady = resolve;
				}),
		},
	});
	Object.defineProperties(video, {
		readyState: { value: 0 },
		videoWidth: { value: 10 },
	});
	const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
	const freeze = vi.fn();
	Object.defineProperty(preview, "getAnimations", {
		value: () => [{ pause: freeze }],
	});
	const frame = vi.fn((callback: FrameRequestCallback) => {
		callback(0);
		return 0;
	});
	vi.stubGlobal("requestAnimationFrame", frame);
	let ready = false;
	const waiting = waitForThumbnailMedia().then(() => {
		ready = true;
	});
	await Promise.resolve();
	expect(ready).toBe(false);
	fontsReady();
	await Promise.resolve();
	imageReady();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	expect(ready).toBe(false);
	video.dispatchEvent(new Event("loadeddata"));
	await waiting;
	expect(frame).toHaveBeenCalledTimes(2);
	expect(pause).toHaveBeenCalledOnce();
	expect(freeze).toHaveBeenCalledOnce();
});

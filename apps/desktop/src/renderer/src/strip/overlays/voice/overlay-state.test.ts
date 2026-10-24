import { Option } from "effect";
import { describe, expect, it } from "vitest";
import type {
	StageEvent,
	VoiceStage,
} from "../../../../../shared/voice-surface";
import {
	initialBar,
	initialOverlay,
	type OverlayState,
	reduceBarLevel,
	reduceBarStage,
	reduceOverlay,
	tickCountdown,
} from "./overlay-state";
import { stripLocale, stripText } from "./strings";
import { overlayLine } from "./voice-context";
import { initialVoiceView } from "./voice-state";

const knob = (stage: VoiceStage, captureId = "k1"): StageEvent => ({
	_tag: "Stage",
	serial: "QK",
	keyCode: "0,1",
	captureId,
	stage,
});
const line = (overlay: OverlayState, locale: "en" | "de" = "en") =>
	overlayLine({ ...initialVoiceView, overlay }, locale);
const run = (events: readonly StageEvent[], start = initialOverlay) =>
	events.reduce(reduceOverlay, start);

describe("voice stage texts", () => {
	it("walks a knob press through DK's texts", () => {
		let state = run([knob({ _tag: "recording", status: "preparing" })]);
		expect(state.visible).toBe(true);
		expect(line(state)).toBe("Preparing to record…");
		state = reduceOverlay(
			state,
			knob({ _tag: "recording", status: "listening" }),
		);
		expect(line(state)).toBe("You can speak now");
		state = reduceOverlay(
			state,
			knob({ _tag: "recording", status: "speaking", transcript: "turn on" }),
		);
		expect(line(state)).toBe("turn on");
		// A VAD update without a partial keeps the recognized text.
		state = reduceOverlay(
			state,
			knob({ _tag: "recording", status: "speaking" }),
		);
		expect(line(state)).toBe("turn on");
		state = reduceOverlay(
			state,
			knob({ _tag: "processing", transcript: "turn on the lights" }),
		);
		expect(line(state)).toBe("turn on the lights");
		state = reduceOverlay(state, knob({ _tag: "idle", outcome: "completed" }));
		expect(state.visible).toBe(false);
	});

	it("says Recording... when speech starts with no partial, not Preparing (DK quirk)", () => {
		const state = run([
			knob({ _tag: "recording", status: "listening" }),
			knob({ _tag: "recording", status: "speaking" }),
		]);
		expect(line(state)).toBe("Recording...");
	});

	it("counts an error down 3-2-1 and closes", () => {
		let state = run([
			knob({ _tag: "recording", status: "preparing" }),
			knob({ _tag: "failed", reason: "server" }),
		]);
		expect(line(state)).toBe("Processing error, please retry (3S)");
		state = tickCountdown(state);
		expect(line(state)).toBe("Processing error, please retry (2S)");
		state = tickCountdown(state);
		expect(line(state)).toBe("Processing error, please retry (1S)");
		state = tickCountdown(state);
		expect(state.visible).toBe(false);
	});

	it("uses the failure message or its error code copy", () => {
		expect(
			line(
				run([knob({ _tag: "failed", reason: "noMic", message: "Mic busy" })]),
			),
		).toBe("Mic busy (3S)");
		expect(
			line(
				run([
					knob({
						_tag: "failed",
						reason: "unavailable",
						errorCode: "VOICE.GRID.RUNTIME_UNAVAILABLE",
					}),
				]),
			),
		).toBe("Failed to start voice. (3S)");
	});

	it("starts the next press fresh after an error (DK's stuck stage)", () => {
		let state = run([knob({ _tag: "failed", reason: "server" }, "a")]);
		for (let i = 0; i < 3; i++) state = tickCountdown(state);
		state = reduceOverlay(
			state,
			knob({ _tag: "recording", status: "preparing" }, "b"),
		);
		expect(state.visible).toBe(true);
		expect(line(state)).toBe("Preparing to record…");
	});

	it("ignores late partials after processing and stale idles", () => {
		let state = run([
			knob({ _tag: "recording", status: "listening" }, "a"),
			knob({ _tag: "processing", transcript: "final" }, "a"),
			knob({ _tag: "recording", status: "speaking", transcript: "fin" }, "a"),
		]);
		expect(line(state)).toBe("final");
		state = reduceOverlay(
			state,
			knob({ _tag: "idle", outcome: "completed" }, "old"),
		);
		expect(state.visible).toBe(true);
	});

	it("shows busy text and localizes", () => {
		const state = run([knob({ _tag: "busy" })]);
		expect(line(state)).toBe("System busy, please try again later");
		expect(
			line(run([knob({ _tag: "recording", status: "preparing" })]), "de"),
		).toBe("Aufnahme wird vorbereitet");
	});
});

describe("mic bar", () => {
	const grid = (
		stage: VoiceStage,
		keyCode = "1,6",
		captureId = "g1",
	): StageEvent => ({
		_tag: "Stage",
		serial: "QK",
		keyCode,
		captureId,
		stage,
	});
	it("shows for grid recording with the transcript row, hides on its own processing", () => {
		let bar = reduceBarStage(
			initialBar,
			grid({ _tag: "recording", status: "preparing" }),
		);
		expect(bar.visible).toBe(true);
		expect(bar.text).toEqual(
			Option.some({ _tag: "string", key: "aiAudio.preparingMic" }),
		);
		// Another key's busy rejection leaves this bar alone.
		bar = reduceBarStage(bar, grid({ _tag: "busy" }, "1,7", "busy"));
		expect(bar.visible).toBe(true);
		bar = reduceBarStage(bar, grid({ _tag: "processing" }));
		expect(bar.visible).toBe(false);
	});
	it("takes levels only from its own key and capture, clamped", () => {
		const bar = reduceBarStage(
			initialBar,
			knob({ _tag: "recording", status: "listening" }),
		);
		expect(bar.text).toEqual(Option.none());
		const other = reduceBarLevel(bar, {
			_tag: "Level",
			serial: "QK",
			keyCode: "1,6",
			captureId: "k1",
			rms: 0.9,
			speaking: true,
		});
		expect(other.rms).toBe(0);
		const mine = reduceBarLevel(bar, {
			_tag: "Level",
			serial: "QK",
			keyCode: "0,1",
			captureId: "k1",
			rms: 0.42,
			speaking: true,
		});
		expect(mine).toMatchObject({ rms: 0.42, speaking: true });
	});
});

describe("strings", () => {
	it("maps the renderer language to DK's locales and interpolates", () => {
		expect(stripLocale("de-DE")).toBe("de");
		expect(stripLocale("zh_CN")).toBe("zh");
		expect(stripLocale("pt-BR")).toBe("en");
		expect(stripLocale(undefined)).toBe("en");
		expect(stripText("en", "aiIconViewTxt.errorCodeLine", { code: 1003 })).toBe(
			"Error code: 1003",
		);
		expect(stripText("en", "aiAudio.busyOnGrid", { name: "<b>x</b>" })).toBe(
			"<b>x</b> is busy, please try again later",
		);
	});
});

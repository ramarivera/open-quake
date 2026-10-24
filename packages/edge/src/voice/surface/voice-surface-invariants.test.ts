import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Either, FastCheck as fc, Option, Schema } from "effect";
import {
	type StageEvent,
	VoiceStage,
	VoiceSurfaceEvent,
	VoiceSurfaceRequest,
} from "./voice-surface-contracts.js";
import {
	type CaptureMemory,
	initialVoiceActivity,
	isHoldToTalkKey,
	meterLevel,
	safeHttpUrl,
	shouldEmitLevel,
	stepStage,
	stepVoiceActivity,
	tileStatusFor,
} from "./voice-surface-invariants.js";

const stage = (
	value: VoiceStage,
	keyCode = "0,1",
	captureId = "c1",
): StageEvent => ({
	_tag: "Stage",
	serial: "QK-1",
	keyCode,
	captureId,
	stage: value,
});

/** Runs a capture through stepStage and collects tones and alerts. */
function feed(events: readonly StageEvent[]) {
	let memory = Option.none<CaptureMemory>();
	const tones: string[] = [];
	const alerts: string[] = [];
	let published = 0;
	for (const event of events) {
		const step = stepStage(memory, event);
		memory = Option.some(step.memory);
		if (step.publish) published++;
		tones.push(...step.feedback.tones);
		if (Option.isSome(step.feedback.alert))
			alerts.push(
				`${step.feedback.alert.value.keyCode}:${step.feedback.alert.value.alert}`,
			);
	}
	return { tones, alerts, published };
}

describe("device feedback", () => {
	it("plays one start and one end for a successful knob turn, with no alert", () => {
		const result = feed([
			stage({ _tag: "recording", status: "preparing" }),
			stage({ _tag: "recording", status: "listening" }),
			stage({ _tag: "recording", status: "speaking", transcript: "hi" }),
			stage({ _tag: "recording", status: "listening" }),
			stage({ _tag: "processing", transcript: "hi" }),
			stage({ _tag: "idle", outcome: "completed" }),
		]);
		expect(result.tones).toEqual(["start", "end"]);
		expect(result.alerts).toEqual([]);
	});

	it("raises an error tone and an invalid alert on a grid key", () => {
		const result = feed([
			stage({ _tag: "recording", status: "preparing" }, "1,6"),
			stage({ _tag: "failed", reason: "server" }, "1,6"),
		]);
		expect(result.tones).toEqual(["error"]);
		expect(result.alerts).toEqual(["1,6:invalid"]);
	});

	it("never alerts the knob key", () => {
		expect(feed([stage({ _tag: "failed", reason: "noMic" })]).alerts).toEqual(
			[],
		);
		expect(feed([stage({ _tag: "busy" })]).tones).toEqual(["busy"]);
	});

	it("is silent for a cancelled press and an empty capture ends with the end tone", () => {
		expect(
			feed([
				stage({ _tag: "recording", status: "preparing" }),
				stage({ _tag: "idle", outcome: "cancelled" }),
			]).tones,
		).toEqual([]);
		expect(
			feed([
				stage({ _tag: "recording", status: "listening" }),
				stage({ _tag: "idle", outcome: "empty" }),
			]).tones,
		).toEqual(["start", "end"]);
	});

	it("drops a repeated stage for the same capture", () => {
		const listening = stage({ _tag: "recording", status: "listening" });
		expect(feed([listening, listening]).published).toBe(1);
	});

	it("starts fresh memory for a new capture", () => {
		const result = feed([
			stage({ _tag: "recording", status: "listening" }, "0,1", "a"),
			stage({ _tag: "idle", outcome: "completed" }, "0,1", "a"),
			stage({ _tag: "recording", status: "listening" }, "0,1", "b"),
		]);
		expect(result.tones).toEqual(["start", "end", "start"]);
	});

	const anyStage = Arbitrary.make(VoiceStage);

	it("plays at most one start and one terminal tone per capture", () => {
		fc.assert(
			fc.property(fc.array(anyStage, { maxLength: 40 }), (stages) => {
				const { tones } = feed(stages.map((value) => stage(value)));
				const count = (tone: string) => tones.filter((t) => t === tone).length;
				expect(count("start")).toBeLessThanOrEqual(1);
				expect(count("end") + count("error")).toBeLessThanOrEqual(1);
			}),
		);
	});
});

describe("contracts", () => {
	const decode = Schema.decodeUnknownEither(VoiceSurfaceEvent);
	it("rejects an rms outside [0,1] and unknown phases", () => {
		expect(
			Either.isLeft(
				decode({
					_tag: "Level",
					serial: "QK",
					keyCode: "0,1",
					captureId: "c",
					rms: 3,
					speaking: true,
				}),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				decode({
					_tag: "Stage",
					serial: "QK",
					keyCode: "0,1",
					captureId: "c",
					stage: { _tag: "dancing" },
				}),
			),
		).toBe(true);
	});
	it("accepts a well-formed stage and rejects bad key codes", () => {
		expect(
			Either.isRight(
				decode({
					_tag: "Stage",
					serial: "QK",
					keyCode: "1,6",
					captureId: "c",
					stage: { _tag: "recording", status: "listening" },
				}),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(VoiceSurfaceRequest)({
					_tag: "Input",
					input: { keyCode: "__proto__", kind: "down", type: "aiChat" },
				}),
			),
		).toBe(true);
	});
});

describe("tile routing", () => {
	it("maps grid stages to AI Copilot statuses (QSV:1870-1918)", () => {
		expect(tileStatusFor({ _tag: "recording", status: "preparing" })).toEqual(
			Option.some(0),
		);
		expect(tileStatusFor({ _tag: "recording", status: "listening" })).toEqual(
			Option.some(3),
		);
		expect(tileStatusFor({ _tag: "processing" })).toEqual(Option.none());
		expect(tileStatusFor({ _tag: "failed", reason: "server" })).toEqual(
			Option.some(-1),
		);
		expect(tileStatusFor({ _tag: "busy" })).toEqual(Option.some(5));
		expect(tileStatusFor({ _tag: "idle", outcome: "completed" })).toEqual(
			Option.some(2),
		);
	});

	it("classifies hold-to-talk keys", () => {
		expect(isHoldToTalkKey({ type: "aiChat", actions: [] })).toBe(true);
		expect(
			isHoldToTalkKey({
				type: "clawbot",
				actions: [{ type: "voiceInput", value: true }],
			}),
		).toBe(true);
		expect(
			isHoldToTalkKey({
				type: "clawbot",
				actions: [{ type: "voiceInput", value: false }],
			}),
		).toBe(false);
		expect(isHoldToTalkKey({ type: "hotkey", actions: [] })).toBe(false);
	});
});

describe("level meter", () => {
	it("scales by 3.5, clamps, and damps silence", () => {
		expect(meterLevel({ analyserRms: 0.1, peak: 0.5 })).toEqual({
			rms: 0.35000000000000003,
			speaking: true,
		});
		expect(meterLevel({ analyserRms: 1, peak: 1 }).rms).toBe(1);
		const quiet = meterLevel({ analyserRms: 0.01, peak: 0.02 });
		expect(quiet.speaking).toBe(false);
		expect(quiet.rms).toBeCloseTo(0.035 * 0.35);
		expect(meterLevel({ analyserRms: Number.NaN, peak: 0 }).rms).toBe(0);
	});

	it("emits at most three silent levels in 400 ms of 20 ms buffers", () => {
		let last = Option.none<number>();
		let emitted = 0;
		for (let now = 0; now < 400; now += 20)
			if (shouldEmitLevel(last, now, false)) {
				emitted++;
				last = Option.some(now);
			}
		expect(emitted).toBeLessThanOrEqual(3);
	});

	it("detects speech above a 15 % peak and clears after 15 quiet buffers", () => {
		let state = stepVoiceActivity(initialVoiceActivity, 0.4);
		expect(state.detected).toBe(true);
		for (let i = 0; i < 14; i++) state = stepVoiceActivity(state, 0.01);
		expect(state.detected).toBe(true);
		state = stepVoiceActivity(state, 0.01);
		expect(state.detected).toBe(false);
	});
});

describe("links", () => {
	it("opens only http(s) URLs with a host and no credentials", () => {
		expect(safeHttpUrl("https://example.com/a?b=1")).toEqual(
			Option.some("https://example.com/a?b=1"),
		);
		expect(safeHttpUrl("javascript:alert(1)")).toEqual(Option.none());
		expect(safeHttpUrl("https://user:pw@host/")).toEqual(Option.none());
		expect(safeHttpUrl("file:///etc/passwd")).toEqual(Option.none());
		expect(safeHttpUrl("not a url")).toEqual(Option.none());
	});
});

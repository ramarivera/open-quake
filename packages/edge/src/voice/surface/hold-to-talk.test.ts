import { describe, expect, it } from "@effect/vitest";
import { FastCheck as fc, Option } from "effect";
import {
	HOLD_TIMING,
	type HoldEffect,
	type HoldInput,
	type HoldState,
	initialHoldState,
	nextDeadline,
	stepHold,
} from "./hold-to-talk.js";

const down = (
	keyCode: string,
	now: number,
	activeFlow: Option.Option<string> = Option.none(),
): HoldInput => ({
	_tag: "down",
	keyCode,
	type: "aiChat",
	agentId: Option.none(),
	now,
	activeFlow,
});

/** Feeds inputs in order, then ticks to `until`, returning effects with times. */
function run(inputs: readonly HoldInput[], until: number) {
	let state: HoldState = initialHoldState;
	const log: Array<{ readonly at: number; readonly effect: HoldEffect }> = [];
	const advance = (to: number) => {
		for (;;) {
			const due = nextDeadline(state);
			if (Option.isNone(due) || due.value > to) return;
			const step = stepHold(state, { _tag: "tick", now: due.value });
			state = step.state;
			for (const effect of step.effects) log.push({ at: due.value, effect });
		}
	};
	for (const input of inputs) {
		advance(input.now);
		const step = stepHold(state, input);
		state = step.state;
		for (const effect of step.effects) log.push({ at: input.now, effect });
	}
	advance(until);
	return { state, log };
}
const tags = (log: ReturnType<typeof run>["log"]) =>
	log.map(({ at, effect }) => `${at}:${effect._tag}:${effect.keyCode}`);

describe("hold-to-talk", () => {
	it("starts capture at 1000 ms and releases once 350 ms after the touch ends", () => {
		const { log } = run(
			[down("1,6", 0), { _tag: "touchEnd", keyCode: "1,6", now: 2400 }],
			10_000,
		);
		expect(tags(log)).toEqual([
			"0:select:1,6",
			"0:keyPress:1,6",
			"1000:startCapture:1,6",
			"2750:release:1,6",
			"2750:keyPress:1,6",
		]);
	});

	it("absorbs a false lift when the finger comes back inside the grace", () => {
		const { log, state } = run(
			[
				down("1,6", 0),
				{ _tag: "touchEnd", keyCode: "1,6", now: 1500 },
				down("1,6", 1700),
			],
			10_000,
		);
		expect(tags(log)).not.toContain("1850:release:1,6");
		expect(log.some(({ effect }) => effect._tag === "release")).toBe(false);
		expect(Option.map(state.held, (held) => held.phase)).toEqual(
			Option.some("capturing"),
		);
	});

	it("treats a 100 ms touch as a short tap: selected, no capture, no release", () => {
		const { log } = run(
			[down("1,6", 0), { _tag: "touchEnd", keyCode: "1,6", now: 100 }],
			5000,
		);
		expect(tags(log)).toEqual([
			"0:select:1,6",
			"0:keyPress:1,6",
			"450:keyPress:1,6",
		]);
	});

	it("frees the reservation without capture when released before the long press", () => {
		const { log, state } = run(
			[down("1,6", 0), { _tag: "touchEnd", keyCode: "1,6", now: 500 }],
			5000,
		);
		expect(log.map(({ effect }) => effect._tag)).toEqual([
			"select",
			"keyPress",
			"keyPress",
		]);
		expect(Option.isNone(state.held)).toBe(true);
	});

	it("rejects a second key with busy while the first is capturing", () => {
		const { log, state } = run([down("1,6", 0), down("1,7", 1200)], 3000);
		expect(tags(log)).toContain("1200:busy:1,7");
		expect(Option.map(state.held, (held) => held.keyCode)).toEqual(
			Option.some("1,6"),
		);
	});

	it("rejects a key while another key's flow is still processing", () => {
		const { log } = run([down("1,7", 0, Option.some("1,6"))], 100);
		expect(tags(log)).toEqual(["0:busy:1,7"]);
	});

	it("cancels the key's own running flow on tap", () => {
		const { log } = run([down("1,6", 0, Option.some("1,6"))], 100);
		expect(tags(log)).toEqual(["0:cancelFlow:1,6"]);
	});

	it("ignores touch cancel and ups without the touch-end flag", () => {
		const { log } = run(
			[
				down("1,6", 0),
				{ _tag: "touchCancel", keyCode: "1,6", now: 1500 },
				{ _tag: "up", keyCode: "1,6", now: 1600, voiceTouchEnd: false },
			],
			20_000,
		);
		expect(log.some(({ effect }) => effect._tag === "release")).toBe(false);
	});

	it("ignores a duplicate down while held", () => {
		const { log } = run([down("1,6", 0), down("1,6", 300)], 500);
		expect(log.filter(({ effect }) => effect._tag === "select")).toHaveLength(
			1,
		);
	});

	it("cancels a running capture on reset", () => {
		const { log } = run([down("1,6", 0), { _tag: "reset", now: 1500 }], 5000);
		expect(tags(log)).toContain("1500:cancelCapture:1,6");
	});
	it("reset takes priority over overdue long-press and release deadlines", () => {
		const pressed = stepHold(initialHoldState, down("1,6", 0)).state;
		const disarmed = stepHold(pressed, { _tag: "reset", now: 2000 });
		expect(disarmed.effects).toEqual([]);
		expect(nextDeadline(disarmed.state)).toEqual(Option.none());
		const capturing = stepHold(pressed, { _tag: "tick", now: 1000 }).state;
		const ending = stepHold(capturing, {
			_tag: "touchEnd",
			keyCode: "1,6",
			now: 1100,
		}).state;
		const cancelled = stepHold(ending, { _tag: "reset", now: 2000 });
		expect(cancelled.effects).toEqual([
			{ _tag: "cancelCapture", keyCode: "1,6", generation: 1 },
		]);
		expect(nextDeadline(cancelled.state)).toEqual(Option.none());
	});

	it("fires a long press that falls inside the grace, then releases", () => {
		const { log } = run(
			[down("1,6", 0), { _tag: "touchEnd", keyCode: "1,6", now: 900 }],
			5000,
		);
		expect(tags(log)).toEqual([
			"0:select:1,6",
			"0:keyPress:1,6",
			"1000:startCapture:1,6",
			"1250:release:1,6",
			"1250:keyPress:1,6",
		]);
	});

	const keyArb = fc.constantFrom("1,6", "1,7", "2,6");
	const inputArb = (now: number): fc.Arbitrary<HoldInput> =>
		fc.oneof(
			keyArb.map((keyCode) => down(keyCode, now)),
			keyArb.map((keyCode): HoldInput => ({ _tag: "touchEnd", keyCode, now })),
			keyArb.map(
				(keyCode): HoldInput => ({ _tag: "touchCancel", keyCode, now }),
			),
			fc.tuple(keyArb, fc.boolean()).map(
				([keyCode, voiceTouchEnd]): HoldInput => ({
					_tag: "up",
					keyCode,
					now,
					voiceTouchEnd,
				}),
			),
			fc.constant<HoldInput>({ _tag: "reset", now }),
		);
	const sequenceArb = fc
		.array(fc.tuple(fc.integer({ min: 0, max: 900 }), fc.nat()), {
			maxLength: 30,
		})
		.chain((gaps) => {
			let now = 0;
			return fc.tuple(
				...gaps.map(([gap]) => {
					now += gap;
					return inputArb(now);
				}),
			);
		});

	it("never releases a key twice within 150 ms, nor a generation twice, nor before its capture", () => {
		fc.assert(
			fc.property(sequenceArb, (inputs) => {
				const { log } = run(inputs, 1_000_000);
				const started = new Map<number, number>();
				const releasedGenerations = new Set<number>();
				const lastRelease = new Map<string, number>();
				for (const { at, effect } of log) {
					if (effect._tag === "startCapture")
						started.set(effect.generation, at);
					if (effect._tag !== "release") continue;
					const startedAt = started.get(effect.generation);
					expect(startedAt).toBeDefined();
					expect(releasedGenerations.has(effect.generation)).toBe(false);
					releasedGenerations.add(effect.generation);
					const previous = lastRelease.get(effect.keyCode);
					if (previous !== undefined)
						expect(at - previous).toBeGreaterThanOrEqual(
							HOLD_TIMING.duplicateReleaseMs,
						);
					lastRelease.set(effect.keyCode, at);
				}
			}),
		);
	});

	it("starts each capture exactly 1000 ms after its down", () => {
		fc.assert(
			fc.property(sequenceArb, (inputs) => {
				const { log } = run(inputs, 1_000_000);
				const downs = new Map<string, number>();
				for (const { at, effect } of log) {
					if (effect._tag === "select") downs.set(effect.keyCode, at);
					if (effect._tag === "startCapture")
						expect(at - (downs.get(effect.keyCode) ?? -1)).toBe(
							HOLD_TIMING.longPressMs,
						);
				}
			}),
		);
	});
});

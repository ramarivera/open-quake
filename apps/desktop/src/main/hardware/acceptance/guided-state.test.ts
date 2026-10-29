import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { KnobResource } from "../../../../../../packages/device/src/knob/knob-contracts";
import { ProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { pinKnobProfile } from "../../knob/voice-route";
import { guidedProfileEnvelope } from "./guided-profile";
import { finishGuidedCapture } from "./guided-shutdown";
import { createGuidedCapture, GUIDED_STEPS } from "./guided-state";

const touch = (action: 0 | 1, x = 100, y = 100) => ({
	kind: "touch",
	points: [{ action, x, y, touchId: "private-id", extra: "private-title" }],
});
it("guides only touch, knob and reconnect and requires actual releases", () => {
	let now = 0;
	const c = createGuidedCapture(() => now++);
	const tap = () => {
		c.accept(touch(1));
		c.accept(touch(0));
	};
	c.accept(touch(0));
	expect(c.current()?.id).toBe("center");
	tap();
	for (let i = 0; i < 5; i++) c.accept({ kind: "rotate", direction: -1 });
	for (let i = 0; i < 5; i++) c.accept({ kind: "rotate", direction: -1 });
	expect(c.current()?.id).toBe("right");
	for (let i = 0; i < 10; i++) c.accept({ kind: "rotate", direction: 1 });
	for (let i = 0; i < 6; i++) c.accept({ kind: "press", state: 1 });
	expect(c.current()?.id).toBe("press");
	for (let i = 0; i < 3; i++) {
		c.accept({ kind: "press", state: 1 });
		c.accept({ kind: "press", state: 0 });
	}
	for (let i = 0; i < 4; i++) tap();
	c.accept(touch(1, 10));
	c.accept(touch(1, 900));
	c.accept(touch(0, 900));
	c.accept({ kind: "status", state: "disconnected", reason: "private" });
	c.accept({ kind: "status", state: "connected" });
	tap();
	expect(c.snapshot().status).toBe("observed");
	expect(c.snapshot().physicalAccepted).toBe(false);
	expect(c.snapshot().steps.map((s) => s.id)).toEqual(
		GUIDED_STEPS.map((s) => s.id),
	);
	expect(JSON.stringify(c.snapshot())).not.toContain("private");
	expect(GUIDED_STEPS.map((s) => s.prompt).join(" ")).not.toMatch(
		/physical key|fifteen|matrix/i,
	);
});
it("bounds evidence and fails incomplete on timeout instead of skipping a missing gesture", () => {
	let now = 0;
	const c = createGuidedCapture(() => now);
	c.accept({ kind: "json", value: { serial: "private" } });
	c.accept(touch(1, Infinity));
	expect(c.snapshot().events).toHaveLength(0);
	now = 61000;
	c.tick();
	expect(c.snapshot().status).toBe("incomplete");
	expect(c.snapshot().steps[0]?.status).toBe("timed-out");
	const bounded = createGuidedCapture(() => 0, 2);
	for (let i = 0; i < 3; i++) bounded.accept(touch(1));
	expect(bounded.snapshot().events).toHaveLength(2);
	expect(bounded.snapshot().status).toBe("incomplete");
});
it("keeps each direction checkpoint pending for opposite turns", () => {
	const c = createGuidedCapture(() => 0);
	c.accept(touch(1));
	c.accept(touch(0));
	const turn = (direction: -1 | 1, count: number) => {
		for (let i = 0; i < count; i++) c.accept({ kind: "rotate", direction });
	};
	turn(1, 5);
	expect(c.current()?.id).toBe("left");
	turn(-1, 10);
	expect(c.current()?.id).toBe("right");
	turn(-1, 5);
	expect(c.current()?.id).toBe("right");
	turn(1, 10);
	expect(c.current()?.id).toBe("press");
});
it("requires a moving contact and its release, not separate stationary taps", () => {
	const c = createGuidedCapture(() => 0);
	const tap = (x = 100) => {
		c.accept(touch(1, x));
		c.accept(touch(0, x));
	};
	tap();
	for (const direction of [-1, 1])
		for (let i = 0; i < 5; i++) c.accept({ kind: "rotate", direction });
	for (let i = 0; i < 3; i++) {
		c.accept({ kind: "press", state: 1 });
		c.accept({ kind: "press", state: 0 });
	}
	for (let i = 0; i < 4; i++) tap();
	expect(c.current()?.id).toBe("swipe");
	tap(100);
	tap(900);
	expect(c.current()?.id).toBe("swipe");
	c.accept(touch(1, 100));
	c.accept(touch(1, 900));
	expect(c.current()?.id).toBe("swipe");
	c.accept(touch(0, 900));
	expect(c.current()?.id).toBe("unplug");
});
it("preserves arrival intervals and queued observations when the renderer overflows", () => {
	let now = 1000;
	const c = createGuidedCapture(() => now);
	now = 1100;
	c.acceptBatch(
		[
			{ event: touch(1), at: 1010 },
			{ event: touch(0), at: 1070 },
		],
		1,
	);
	expect(c.snapshot().events.map((e) => e.t)).toEqual([10, 70]);
	expect(c.snapshot().status).toBe("incomplete");
	expect(c.snapshot().reason).toBe("buffer-overflow");
});
it("rejects invalid arrival clocks before retaining an event", () => {
	let now = 100;
	const c = createGuidedCapture(() => now);
	now = 200;
	for (const at of [NaN, Infinity, 99, 201]) c.accept(touch(1), at);
	expect(c.snapshot().events).toHaveLength(0);
});
it("retains queued gestures without answering a prompt that was not shown", () => {
	const c = createGuidedCapture(() => 0);
	c.acceptBatch(
		[
			{ event: touch(1), at: 0, step: "center" },
			{ event: touch(0), at: 0, step: "center" },
			...Array.from({ length: 5 }, () => ({
				event: { kind: "rotate", direction: -1 },
				at: 0,
				step: "center" as const,
			})),
		],
		0,
	);
	expect(c.current()?.id).toBe("left");
	expect(c.snapshot().events).toHaveLength(7);
	c.acceptBatch(
		Array.from({ length: 5 }, () => ({
			event: { kind: "rotate", direction: -1 },
			at: 0,
			step: "left" as const,
		})),
		0,
	);
	expect(c.current()?.id).toBe("right");
});
it("tracks a replacement contact in one frame without treating two fingers as movement", () => {
	const toSwipe = () => {
		const c = createGuidedCapture(() => 0);
		c.accept(touch(1));
		c.accept(touch(0));
		for (const direction of [-1, 1])
			for (let i = 0; i < 5; i++) c.accept({ kind: "rotate", direction });
		for (let i = 0; i < 3; i++) {
			c.accept({ kind: "press", state: 1 });
			c.accept({ kind: "press", state: 0 });
		}
		for (let i = 0; i < 4; i++) {
			c.accept(touch(1));
			c.accept(touch(0));
		}
		return c;
	};
	const c = toSwipe();
	c.accept(touch(1, 100));
	c.accept({
		kind: "touch",
		points: [
			{ action: 0, x: 100, y: 100 },
			{ action: 1, x: 300, y: 100 },
		],
	});
	c.accept(touch(1, 350));
	c.accept(touch(0, 350));
	expect(c.current()?.id).toBe("unplug");
	const multi = toSwipe();
	multi.accept({
		kind: "touch",
		points: [
			{ action: 1, x: 100, y: 100 },
			{ action: 1, x: 300, y: 100 },
		],
	});
	multi.accept({
		kind: "touch",
		points: [
			{ action: 0, x: 100, y: 100 },
			{ action: 0, x: 300, y: 100 },
		],
	});
	expect(multi.current()?.id).toBe("swipe");
});
it("attempts cleanup after finalization failure and rejects success on either failure", async () => {
	for (const failed of ["capture", "cleanup", "both", "neither"]) {
		let closed = 0;
		const finalization = Promise.resolve().then(() => {
			if (failed === "capture" || failed === "both")
				throw new Error("fixture failure");
		});
		const code = await finishGuidedCapture(
			finalization,
			async () => {
				closed++;
				if (failed === "cleanup" || failed === "both")
					throw new Error("fixture failure");
			},
			0,
		);
		expect(closed).toBe(1);
		expect(code).toBe(failed === "neither" ? 0 : 1);
	}
});
it("seeds one fresh inert touch profile with no provider or host actions", async () => {
	const envelope = guidedProfileEnvelope();
	const encoded = Schema.encodeSync(ProfileEnvelope)(envelope);
	expect(encoded.profiles).toHaveLength(1);
	expect(encoded.profiles[0]?.pages[0]?.keys).toHaveLength(16);
	for (const key of encoded.profiles[0]?.pages[0]?.keys ?? []) {
		expect(key.config.type).toBe("pageNo");
		expect(key.config.actions).toEqual([]);
	}
	const knob = Schema.decodeUnknownSync(KnobResource)(
		encoded.profiles[0]?.knob,
	);
	expect(knob.config.subActions).toHaveLength(3);
	for (const slot of knob.config.subActions) expect(slot.config.type).toBe("");
	expect(JSON.stringify(encoded)).not.toMatch(
		/voiceRoute|https:|hotkey|keychain|agentId/,
	);
});

it("cannot pin microphone capture from the fixture even after device selection", async () => {
	const fixture = guidedProfileEnvelope();
	const selected = Schema.decodeUnknownSync(ProfileEnvelope)({
		...Schema.encodeSync(ProfileEnvelope)(fixture),
		activeByDevice: { fixture: { profileId: "guided-capture", pageId: "1" } },
	});
	for (const envelope of [fixture, selected]) {
		const result = await Effect.runPromise(
			pinKnobProfile(envelope, "fixture").pipe(Effect.either),
		);
		expect(result._tag).toBe("Left");
	}
});

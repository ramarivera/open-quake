import { checksum } from "@open-quake/protocol";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { makeFakeHardwareTransport } from "../../../../../../packages/device/src/hardware/hardware-fake.js";
import { CAPTURE_STEPS, runInputCapture } from "./capture.js";

vi.mock("node-hid", () => {
	throw new Error("Default tests must not load native HID");
});

const short = (op: number, cmd: number, data: number[]) => {
	const body = new Uint8Array(32);
	body.set([
		0xa3,
		data.length + 2,
		op,
		cmd,
		...data,
		checksum([op, cmd, ...data]),
	]);
	return body;
};
const matrix = (pressed: number[]) => {
	const body = new Uint8Array(32);
	body[0] = 1;
	for (const index of pressed) body[4 + index] = 1;
	return body;
};
const steps = (ids: readonly string[]) =>
	CAPTURE_STEPS.filter((step) => ids.includes(step.id)).map((step) => ({
		...step,
		timeoutMs: Math.min(step.timeoutMs, 2_000),
	}));

it("records keys, knob, lights and a reconnect, restoring the lights", async () => {
	const fake = await Effect.runPromise(
		makeFakeHardwareTransport({ serial: "private-capture" }),
	);
	const input: Record<string, Uint8Array[]> = {
		keys: Array.from({ length: 15 }, (_, index) => [
			matrix([index]),
			matrix([]),
		]).flat(),
		"knob-left": Array(5).fill(short(3, 1, [0])),
		"knob-right": Array(5).fill(short(3, 1, [1])),
		"knob-press": [1, 0, 1, 0, 1, 0].map((state) => short(3, 2, [state])),
		"key-after-replug": [matrix([4]), matrix([])],
	};
	let index = 0;
	const ids = [
		"keys",
		"knob-left",
		"knob-right",
		"knob-press",
		"lights",
		"unplug",
		"replug",
		"key-after-replug",
	];
	const result = await Effect.runPromise(
		Effect.scoped(
			runInputCapture({
				serial: "private-capture",
				steps: steps(ids),
				lightDelayMs: 5,
				reconnectDelayMs: 20,
				announce: () =>
					Effect.gen(function* () {
						const id = ids[index++];
						if (id === "unplug") return yield* fake.end();
						for (const report of input[id ?? ""] ?? [])
							yield* fake.emit(report);
					}).pipe(Effect.delay(20)),
			}),
		).pipe(Effect.provide(fake.layer)),
	);
	expect(result.checks).toEqual(ids.map((id) => ({ id, status: "passed" })));
	const kinds = new Set(result.evidence.events.map((event) => event.kind));
	expect([...kinds]).toEqual(
		expect.arrayContaining([
			"matrix",
			"knob",
			"knob-press",
			"light",
			"disconnect",
			"reconnected",
		]),
	);
	expect(JSON.stringify(result.evidence)).not.toContain("private-capture");
});

it("times out a step without evidence instead of passing it", async () => {
	const fake = await Effect.runPromise(
		makeFakeHardwareTransport({ serial: "private-capture" }),
	);
	const result = await Effect.runPromise(
		Effect.scoped(
			runInputCapture({
				serial: "private-capture",
				steps: steps(["knob-left"]).map((step) => ({
					...step,
					timeoutMs: 200,
				})),
				announce: () => Effect.void,
			}),
		).pipe(Effect.provide(fake.layer)),
	);
	expect(result.checks).toEqual([
		{ id: "knob-left", status: "failed", reason: "timed out" },
	]);
});

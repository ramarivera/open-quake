import {
	encodeHidReport,
	QUAKE_IDENTITY,
	wrapShortCommand,
} from "@open-quake/protocol";
import { Effect, Either, Layer, Option, Queue, Stream } from "effect";
import { expect, it, vi } from "vitest";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import {
	allowedProbeWrite,
	assertNoSerial,
	decodeTick,
	matchQueryReply,
	queryReport,
	redactName,
	runQueryProbe,
} from "./probe.js";

vi.mock("node-hid", () => {
	throw new Error("Default tests must not load native HID");
});

const report = (opCode: number, cmdId: number, subData: number[] = []) =>
	Either.getOrThrow(
		wrapShortCommand({ opCode, cmdId, subData }).pipe(
			Either.flatMap(encodeHidReport),
		),
	);

it("allows only flag-2 queries from the reviewed catalog", () => {
	for (const cmdId of [3, 4, 5, 7, 0x2d, 0x2e, 0xef])
		expect(allowedProbeWrite(report(2, cmdId))).toBe(true);
	// Screen power, DFU, firmware upload, key injection and GPIO stay refused.
	expect(allowedProbeWrite(report(1, 4, [0]))).toBe(false);
	expect(allowedProbeWrite(report(2, 0x2f))).toBe(false);
	expect(allowedProbeWrite(report(2, 0x20))).toBe(false);
	expect(allowedProbeWrite(report(2, 0x10))).toBe(false);
	expect(allowedProbeWrite(report(2, 0x1d))).toBe(false);
	expect(allowedProbeWrite(report(2, 4, [1]))).toBe(false);
});

it("matches replies by command and decodes the device tick", () => {
	const body = report(0x55, 0x2d, [0, 0, 1, 0, 0, 0, 3, 232]).slice(1);
	const reply = matchQueryReply(body, 0x2d);
	expect(Option.isSome(reply) && reply.value.checksumValid).toBe(true);
	expect(matchQueryReply(body, 0x07)).toEqual(Option.none());
	expect(decodeTick(Option.getOrThrow(reply).subData)).toEqual({
		now: 256,
		elapsed: 1000,
	});
	expect(decodeTick([1, 2])).toBeUndefined();
});

it("never keeps the device-name bytes, which carry the serial", () => {
	const subData = [...Array.from("PRIVATE01", (c) => c.charCodeAt(0)), 0, 0];
	expect(
		redactName({ raw: [], subData, checksumValid: true }, "PRIVATE01"),
	).toEqual({ length: 9, equalsSelectedSerial: true, checksumValid: true });
	expect(() => assertNoSerial({ raw: subData }, "PRIVATE01")).toThrow(
		"must not contain",
	);
	expect(() => assertNoSerial({ name: "PRIVATE01" }, "PRIVATE01")).toThrow();
	expect(() => assertNoSerial({ raw: [1, 2] }, "PRIVATE01")).not.toThrow();
});

it("records the catalog, keep-alive counts, tick rate and starvation state", async () => {
	let count = 0;
	let reference = 0;
	const writes: Uint8Array[] = [];
	const transport = Layer.effect(
		HidTransport,
		Effect.gen(function* () {
			const inbox = yield* Queue.unbounded<Uint8Array>();
			const reply = (cmdId: number, sub: number[]) =>
				Queue.offer(inbox, report(0x55, cmdId, sub).slice(1));
			return {
				discover: () =>
					Effect.succeed([
						{ ...QUAKE_IDENTITY, path: "fake", serialNumber: "private-probe" },
					]),
				open: () =>
					Effect.succeed({
						reports: Stream.fromQueue(inbox),
						write: (bytes: Uint8Array) =>
							Effect.gen(function* () {
								writes.push(bytes);
								const cmdId = bytes[4] ?? 0;
								const now = Math.round(performance.now());
								if (cmdId === 0xef) {
									reference = now;
									return yield* reply(0xef, [count++]);
								}
								if (cmdId === 0x2d) {
									const elapsed = now - reference;
									reference = now;
									return yield* reply(0x2d, [
										0,
										0,
										0,
										0,
										(elapsed >> 24) & 255,
										(elapsed >> 16) & 255,
										(elapsed >> 8) & 255,
										elapsed & 255,
									]);
								}
								// The real firmware answers the name query with the serial.
								if (cmdId === 0x1f)
									return yield* reply(
										0x1f,
										Array.from("private-probe", (c) => c.charCodeAt(0)),
									);
								yield* reply(cmdId, [1]);
							}),
						close: () => Effect.void,
					}),
			};
		}),
	);
	const result = await Effect.runPromise(
		Effect.scoped(
			runQueryProbe({
				serial: "private-probe",
				starvationMs: 50,
				intervalsMs: [100, 300],
			}),
		).pipe(Effect.provide(transport)),
	);
	expect(result.checks.filter((check) => check.status === "failed")).toEqual(
		[],
	);
	expect(
		(result.evidence.catalog as Record<string, unknown>)["device-name"],
	).toEqual({ length: 13, equalsSelectedSerial: true, checksumValid: true });
	expect(result.evidence.keepAliveCounts).toEqual([0, 1, 2]);
	expect(result.evidence.ticksPerMs).toBeCloseTo(1, 0);
	expect(writes.every(allowedProbeWrite)).toBe(true);
	expect(result.writes).toBe(writes.length);
	expect(Either.isRight(queryReport(0x2d))).toBe(true);
});

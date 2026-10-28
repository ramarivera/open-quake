import assert from "node:assert/strict";
import {
	decodeHidReport,
	encodeHidReport,
	isQuakeInterface,
	unwrapShortCommand,
	wrapShortCommand,
} from "@open-quake/protocol";
import { Effect, Either, Option, Queue, Stream } from "effect";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";
import { safeCause } from "../../diagnostics/privacy.js";
import { exactDeviceTransport } from "./exact-device.js";
import type { ExtendedCheck } from "./extended.js";

// Query-only branches in .context/decokee-quake-fw/src/protocol/quake_commands.c.
// Each replies {0x55, cmdId, state} and changes nothing except 0x2D, which
// restarts the same idle reference a keep-alive refreshes.
export const PROBE_QUERIES = [
	{ cmdId: 0x02, name: "brightness-pwm4" },
	{ cmdId: 0x04, name: "screen-power" },
	{ cmdId: 0x06, name: "buzzer-led-effect" },
	{ cmdId: 0x07, name: "idle-flags" },
	{ cmdId: 0x1e, name: "config-byte" },
	{ cmdId: 0x1f, name: "device-name" },
	{ cmdId: 0x2d, name: "tick" },
] as const;
const KEEP_ALIVE = 0xef;
const ALLOWED = new Set<number>([
	3,
	5,
	0x2e,
	KEEP_ALIVE,
	...PROBE_QUERIES.map((query) => query.cmdId),
]);

/** Flag-2 queries only: no set, keyboard, firmware, DFU or screen-power write. */
export function allowedProbeWrite(report: Uint8Array): boolean {
	if (report.length !== 33 || report[0] !== 0) return false;
	const decoded = decodeHidReport(report).pipe(
		Either.flatMap(unwrapShortCommand),
	);
	return (
		Either.isRight(decoded) &&
		decoded.right.opCode === 2 &&
		decoded.right.subData.length === 0 &&
		ALLOWED.has(decoded.right.cmdId)
	);
}

export const queryReport = (cmdId: number) =>
	wrapShortCommand({ opCode: 2, cmdId, subData: [] }).pipe(
		Either.flatMap(encodeHidReport),
	);

export interface QueryReply {
	/** Declared frame bytes, at most 16, so a firmware variant stays inspectable. */
	readonly raw: readonly number[];
	readonly subData: readonly number[];
	readonly checksumValid: boolean;
}

/** Matches a state reply by header and command even when its checksum disagrees. */
export function matchQueryReply(
	report: Uint8Array,
	cmdId: number,
): Option.Option<QueryReply> {
	const body = Either.getOrUndefined(decodeHidReport(report));
	if (body?.[0] !== 0xa3 || body[2] !== 0x55 || body[3] !== cmdId)
		return Option.none();
	const raw = Array.from(body.slice(0, Math.min(16, 3 + (body[1] ?? 0))));
	const decoded = unwrapShortCommand(body);
	return Option.some({
		raw,
		subData: Either.isRight(decoded)
			? Array.from(decoded.right.subData)
			: raw.slice(4, -1),
		checksumValid: Either.isRight(decoded),
	});
}

/** The 0x1F name reply is the device serial on QUAKE:3:1.0.19, so keep only
 * its relation to the selected device, never its bytes. */
export function redactName(reply: QueryReply, serial: string) {
	const name = String.fromCharCode(...reply.subData.filter((byte) => byte));
	return {
		length: name.length,
		equalsSelectedSerial: canonicalHidSerial(name) === serial,
		checksumValid: reply.checksumValid,
	};
}

/** Fails closed if the serial reaches evidence as text or inside any byte array. */
export function assertNoSerial(evidence: unknown, serial: string) {
	const texts: string[] = [];
	const visit = (value: unknown): void => {
		if (typeof value === "string") texts.push(value);
		else if (Array.isArray(value)) {
			if (value.every((item) => typeof item === "number"))
				texts.push(String.fromCharCode(...value.map((item) => item & 255)));
			else value.forEach(visit);
		} else if (value && typeof value === "object")
			for (const [key, item] of Object.entries(value)) {
				texts.push(key);
				visit(item);
			}
	};
	visit(evidence);
	assert(
		texts.every((text) => !text.includes(serial)),
		"Probe evidence must not contain the device serial",
	);
}

/** Big-endian current tick and ticks since the previous idle reference. */
export function decodeTick(subData: readonly number[]) {
	if (subData.length < 8) return undefined;
	const be32 = (offset: number) =>
		subData
			.slice(offset, offset + 4)
			.reduce((value, byte) => value * 256 + byte, 0);
	return { now: be32(0), elapsed: be32(4) };
}

/** Opt-in read-only query probe. Evidence only; it never writes device state. */
export const runQueryProbe = Effect.fn("HardwareAcceptance.probe")(
	function* (options: {
		readonly serial: string;
		readonly starvationMs: number;
		readonly intervalsMs: readonly number[];
	}) {
		assert(options.starvationMs >= 0 && options.starvationMs <= 40_000);
		const checks: ExtendedCheck[] = [];
		const evidence: Record<string, unknown> = {};
		const transport = exactDeviceTransport(yield* HidTransport, options.serial);
		const selected = (yield* transport.discover()).filter(
			(info) =>
				isQuakeInterface(info) &&
				canonicalHidSerial(info.serialNumber ?? "") === options.serial,
		);
		assert.equal(selected.length, 1, "Expected one exact control interface");
		const info = selected[0];
		assert(info);
		let writes = 0;
		const handle = yield* Effect.acquireRelease(transport.open(info), (open) =>
			open.close().pipe(Effect.ignoreLogged),
		);
		const inbox = yield* Queue.unbounded<Uint8Array>();
		yield* handle.reports.pipe(
			Stream.runForEach((report) => Queue.offer(inbox, report)),
			Effect.forkScoped,
		);
		const query = (cmdId: number) =>
			Effect.gen(function* () {
				const report = queryReport(cmdId);
				assert(Either.isRight(report) && allowedProbeWrite(report.right));
				yield* Queue.takeAll(inbox);
				yield* handle.write(report.right);
				writes++;
				return yield* Effect.gen(function* () {
					while (true) {
						const reply = matchQueryReply(yield* Queue.take(inbox), cmdId);
						if (Option.isSome(reply)) return reply.value;
					}
				}).pipe(Effect.timeoutOption(1_000));
			});
		// Every probe reply is required: silence or a bad checksum fails its check.
		const valid = (reply: Option.Option<QueryReply>, what: string) => {
			assert(Option.isSome(reply), `No ${what} reply within 1 s`);
			assert(reply.value.checksumValid, `Invalid ${what} reply checksum`);
			return reply.value;
		};
		const ask = (cmdId: number, what: string) =>
			query(cmdId).pipe(Effect.map((reply) => valid(reply, what)));
		const step = (id: string, effect: Effect.Effect<unknown, unknown>) =>
			Effect.exit(effect).pipe(
				Effect.map((exit) =>
					checks.push(
						exit._tag === "Failure"
							? { id, status: "failed", cause: safeCause(exit.cause) }
							: { id, status: "passed" },
					),
				),
			);

		const catalog: Record<string, unknown> = {};
		for (const { cmdId, name } of PROBE_QUERIES)
			yield* step(
				`query-${name}`,
				query(cmdId).pipe(
					Effect.map((reply) => {
						// Corrupt replies stay in evidence for diagnosis, then fail.
						catalog[name] = Option.match(reply, {
							onNone: () => null,
							onSome: (value) =>
								cmdId === 0x1f ? redactName(value, options.serial) : value,
						});
						return valid(reply, name);
					}),
				),
			);
		evidence.catalog = catalog;

		yield* step(
			"keepalive-counter-increments",
			Effect.gen(function* () {
				const counts: number[] = [];
				for (let index = 0; index < 3; index++) {
					const reply = yield* ask(KEEP_ALIVE, "keep-alive");
					counts.push(reply.subData[0] ?? -1);
					yield* Effect.sleep(300);
				}
				evidence.keepAliveCounts = counts;
				assert.deepEqual(
					counts,
					counts.map((_, index) => ((counts[0] ?? 0) + index) % 256),
					"Keep-alive counts are not consecutive",
				);
			}),
		);

		yield* step(
			"device-measured-keepalive-interval",
			Effect.gen(function* () {
				const rows: Array<{ hostMs: number; deviceTicks: number }> = [];
				for (const interval of options.intervalsMs) {
					yield* ask(KEEP_ALIVE, "keep-alive");
					const start = performance.now();
					yield* Effect.sleep(interval);
					const reply = yield* ask(0x2d, "tick");
					const hostMs = performance.now() - start;
					const tick = decodeTick(reply.subData);
					assert(tick, "Tick reply is too short");
					rows.push({ hostMs: Math.round(hostMs), deviceTicks: tick.elapsed });
				}
				evidence.intervals = rows;
				const ratios = rows.map((row) => row.deviceTicks / row.hostMs);
				const low = Math.min(...ratios),
					high = Math.max(...ratios);
				assert(
					low > 0 && high / low < 1.1,
					"Device tick rate disagrees across intervals",
				);
				evidence.ticksPerMs = Number(((low + high) / 2).toFixed(3));
				assert(
					low > 0.95 && high < 1.05,
					"Device tick is not one per millisecond",
				);
			}),
		);

		yield* step(
			"keepalive-starvation-observation",
			Effect.gen(function* () {
				const state = Effect.gen(function* () {
					const screen = yield* ask(0x04, "screen-power");
					const idle = yield* ask(0x07, "idle-flags");
					return { screen: screen.subData[0], idle: idle.subData[0] };
				});
				const before = yield* state;
				const primed = yield* ask(KEEP_ALIVE, "keep-alive");
				yield* Effect.sleep(options.starvationMs);
				const after = yield* state;
				const resumed = yield* ask(KEEP_ALIVE, "keep-alive");
				evidence.starvation = {
					starvedMs: options.starvationMs,
					before,
					after,
					countBefore: primed.subData[0],
					countAfter: resumed.subData[0],
				};
			}),
		);
		assertNoSerial(evidence, options.serial);
		return { checks, evidence, writes };
	},
);

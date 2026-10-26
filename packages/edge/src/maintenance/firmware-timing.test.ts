import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, TestClock } from "effect";
import { type FirmwareSnapshot, idleFirmware } from "./contracts.js";
import {
	FirmwarePort,
	FirmwareUpdates,
	type firmwareTiming,
} from "./firmware-service.js";
import {
	FirmwareUnavailable,
	FirmwareWriteFailed,
} from "./maintenance-errors.js";

function fixture(
	options: {
		loaded?: FirmwareSnapshot;
		saveDelay?: Effect.Effect<void>;
		partial?: boolean;
		offline?: boolean;
		hanging?: boolean;
		timing?: Partial<Record<keyof typeof firmwareTiming, number>>;
	} = {},
) {
	const events: FirmwareSnapshot[] = [];
	const saved: FirmwareSnapshot[] = [];
	const versions: string[] = [];
	let report: (bytes: number) => void = () => {};
	const layer = Layer.effect(
		FirmwarePort,
		Effect.gen(function* () {
			const copying = yield* Deferred.make<void>();
			const finish = yield* Deferred.make<void>();
			return {
				timing: { settle: 1, ...options.timing },
				publish: (s: FirmwareSnapshot) => events.push(s),
				current: () =>
					Effect.succeed({
						serial: "chosen",
						session: "session",
						version: "1.0.19",
					}),
				version: (serial: string) => {
					versions.push(serial);
					return options.hanging
						? Effect.never
						: options.offline
							? Effect.fail(new FirmwareUnavailable())
							: Effect.succeed("1.0.21");
				},
				image: () =>
					Effect.succeed({
						trusted: true,
						version: "1.0.21",
						fingerprint: "synthetic",
						fileName: "synthetic.uf2",
						bytes: 10000,
					}),
				enter: () => Effect.void,
				volumes: () =>
					Effect.succeed([{ id: "chosen-volume", label: "Synthetic DFU" }]),
				copy: (_image, _volume, progress) =>
					Effect.gen(function* () {
						report = progress;
						yield* Deferred.succeed(copying, undefined);
						yield* Deferred.await(finish);
						if (options.partial) return yield* new FirmwareWriteFailed();
					}),
				load: () => Effect.succeed(options.loaded),
				save: (snapshot) =>
					Effect.gen(function* () {
						if (options.saveDelay) yield* options.saveDelay;
						saved.push(snapshot);
					}),
			} satisfies typeof FirmwarePort.Service;
		}),
	);
	return {
		layer: FirmwareUpdates.Default.pipe(Layer.provide(layer)),
		events,
		saved,
		versions,
		report: (bytes: number) => report(bytes),
	};
}
it.scoped(
	"publishes at 199/200ms or 1% delta and forces every state/step transition",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* TestClock.adjust(1);
			yield* s.write("chosen-volume");
			yield* TestClock.adjust(1);
			const begin = f.events.length;
			f.report(99);
			expect(f.events).toHaveLength(begin);
			yield* TestClock.adjust(198);
			f.report(99);
			expect(f.events).toHaveLength(begin);
			yield* TestClock.adjust(1);
			f.report(99);
			expect(f.events).toHaveLength(begin + 1);
			f.report(198);
			expect(f.events).toHaveLength(begin + 1);
			f.report(199);
			expect(f.events).toHaveLength(begin + 2);
			f.report(-1);
			f.report(Number.NaN);
			f.report(10001);
			expect(f.events).toHaveLength(begin + 2);
			expect(f.events.map((e) => e.state)).toEqual([
				"checking",
				"entering_download_mode",
				"waiting_volume",
				"ready_to_write",
				"copying",
				"copying",
				"copying",
			]);
			expect(f.events.at(-1)?.copied).toBe(199);
			// Closing a running session queries the exact serial and never cancels it.
			expect(yield* s.close()).toEqual({ serial: "chosen", version: "1.0.21" });
			expect((yield* s.snapshot()).state).toBe("copying");
			expect(f.versions).toEqual(["chosen"]);
		}).pipe(Effect.provide(f.layer));
	},
);
for (const state of ["success", "failed", "needs_recovery"] as const) {
	it.scoped(
		`retains ${state} at 599999ms and expires at 600000ms even when endedAt is zero`,
		() => {
			const f = fixture({
				loaded: { ...idleFirmware, state, serial: "chosen", endedAt: 0 },
			});
			return Effect.gen(function* () {
				const s = yield* FirmwareUpdates;
				yield* TestClock.adjust(599999);
				expect((yield* s.snapshot()).state).toBe(state);
				yield* TestClock.adjust(1);
				expect((yield* s.snapshot()).state).toBe("idle");
				expect(f.events.at(-1)?.state).toBe("idle");
			}).pipe(Effect.provide(f.layer));
		},
	);
}
for (const hanging of [false, true]) {
	it.scoped(
		`close tolerates unavailable version with bounded query hanging=${hanging}`,
		() => {
			const f = fixture({
				loaded: { ...idleFirmware, state: "success", serial: "intended" },
				offline: true,
				hanging,
			});
			return Effect.gen(function* () {
				const s = yield* FirmwareUpdates;
				const closing = yield* s.close().pipe(Effect.fork);
				if (hanging) yield* TestClock.adjust(3000);
				expect(yield* Fiber.join(closing)).toEqual({
					serial: "intended",
					version: undefined,
				});
				expect((yield* s.snapshot()).state).toBe("idle");
				expect(f.versions).toEqual(["intended"]);
			}).pipe(Effect.provide(f.layer));
		},
	);
}

for (const timing of [
	{ progressInterval: 0 },
	{ progressDelta: 1.1 },
	{ settle: Number.NaN },
]) {
	it.scoped(
		`rejects invalid controlled timing override ${JSON.stringify(timing)}`,
		() => {
			const f = fixture({ timing });
			return Effect.gen(function* () {
				const result = yield* FirmwareUpdates.pipe(
					Effect.provide(f.layer),
					Effect.either,
				);
				expect(result).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.FIRMWARE.TARGET_MISMATCH" },
				});
				expect(f.events).toEqual([]);
			});
		},
	);
}

it.scoped(
	"persists intermediate copy progress at most once per interval and restores those bytes after restart",
	() => {
		const f = fixture();
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* TestClock.adjust(1);
			yield* s.write("chosen-volume");
			yield* TestClock.adjust(1);
			const initial = f.saved.length;
			for (let copied = 1; copied <= 9000; copied++) f.report(copied);
			yield* TestClock.adjust(199);
			expect(f.saved).toHaveLength(initial);
			yield* TestClock.adjust(1);
			expect(f.saved).toHaveLength(initial + 1);
			expect(f.saved.at(-1)).toMatchObject({ state: "copying", copied: 9000 });
			yield* TestClock.adjust(1000);
			expect(f.saved).toHaveLength(initial + 1);
			f.report(9500);
			yield* TestClock.adjust(200);
			expect(f.saved).toHaveLength(initial + 2);
			const loaded = f.saved.at(-1);
			if (!loaded) throw new Error("Missing persisted snapshot");
			yield* s.shutdown();
			const restarted = fixture({ loaded });
			const restored = yield* Effect.gen(function* () {
				const next = yield* FirmwareUpdates;
				return yield* next.snapshot();
			}).pipe(Effect.provide(restarted.layer));
			expect(restored).toMatchObject({
				state: "needs_recovery",
				copied: 9500,
				reason: "interrupted",
			});
		}).pipe(Effect.provide(f.layer));
	},
);

it.scoped(
	"serializes concurrent terminal expiry reads so exactly one state save occurs",
	() => {
		const f = fixture({
			loaded: { ...idleFirmware, state: "success", endedAt: 0 },
			saveDelay: Effect.yieldNow(),
		});
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* TestClock.adjust(600000);
			const snapshots = yield* Effect.all(
				[s.snapshot(), s.snapshot(), s.snapshot()],
				{ concurrency: "unbounded" },
			);
			expect(snapshots.every((snapshot) => snapshot.state === "idle")).toBe(
				true,
			);
			expect(f.saved).toHaveLength(1);
		}).pipe(Effect.provide(f.layer));
	},
);

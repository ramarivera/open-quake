import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	TestClock,
} from "effect";
import { type FirmwareSnapshot, idleFirmware } from "./contracts.js";
import {
	FirmwarePort,
	FirmwareUpdates,
	firmwareTiming,
} from "./firmware-service.js";
import {
	AppUpdateFailed,
	BackupFailed,
	FirmwarePersistenceFailed,
	FirmwareUnavailable,
	FirmwareWriteFailed,
	MaintenanceErrors,
	ResetFailed,
} from "./maintenance-errors.js";
import { DataReset, ResetPort } from "./reset-service.js";
import {
	type AppRelease,
	AppUpdatePort,
	AppUpdates,
	appUpdateTiming,
} from "./update-service.js";

function firmwareFixture(
	options: {
		volume?: boolean;
		version?: string;
		copyFails?: boolean;
		restart?: boolean;
		unknown?: boolean;
		offline?: boolean;
		failSave?: (state: FirmwareSnapshot) => boolean;
		load?: () => Effect.Effect<unknown, FirmwarePersistenceFailed>;
	} = {},
) {
	const calls: string[] = [];
	const records: unknown[] = [];
	const layer = FirmwareUpdates.Default.pipe(
		Layer.provide(
			Layer.succeed(FirmwarePort, {
				current: () =>
					options.offline
						? Effect.fail(new FirmwareUnavailable())
						: Effect.succeed({
								serial: "chosen",
								version: "1.0.19",
								session: "chosen-session",
							}),
				version: (serial) => {
					calls.push(`version:${serial}`);
					return options.unknown
						? Effect.fail(new FirmwareUnavailable())
						: Effect.succeed(options.version ?? "1.0.21");
				},
				image: () =>
					Effect.succeed({
						version: "1.0.21",
						fingerprint: "trusted",
						bytes: 1024,
						fileName: "fixture.uf2",
						trusted: true,
					}),
				enter: (serial) =>
					Effect.sync(() => {
						calls.push(`enter:${serial}`);
					}),
				volumes: () =>
					Effect.succeed(
						options.volume === false
							? []
							: [
									{ id: "first", label: "QUAKE DFU" },
									{ id: "second", label: "QUAKE DFU" },
								],
					),
				copy: (_, volume, progress) =>
					Effect.gen(function* () {
						calls.push(`copy:${volume.id}`);
						progress(512);
						if (options.copyFails) return yield* new FirmwareWriteFailed();
						progress(1024);
					}),
				load:
					options.load ??
					(() =>
						Effect.succeed(
							options.restart
								? { ...idleFirmware, state: "copying", serial: "chosen" }
								: undefined,
						)),
				save: (state) =>
					Effect.gen(function* () {
						if (options.failSave?.(state))
							return yield* new FirmwarePersistenceFailed();
						records.push(state);
					}),
			}),
		),
	);
	return { layer, calls, records };
}
const flush = TestClock.adjust(1);
describe("firmware session", () => {
	it.scoped(
		"stops firmware workers before releasing shared-owner bookmarks",
		() => {
			const f = firmwareFixture();
			return Effect.gen(function* () {
				const service = yield* FirmwareUpdates;
				yield* service.start({ serial: "chosen", session: "chosen-session" });
				yield* flush;
				expect((yield* service.snapshot()).state).toBe("ready_to_write");
				yield* service.write("first");
				yield* service.shutdown();
				yield* TestClock.adjust(firmwareTiming.settle + firmwareTiming.verify);
				expect(f.calls.filter((call) => call.startsWith("copy:"))).toEqual([]);
				expect(yield* Effect.either(service.recover("chosen"))).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.FIRMWARE.UNAVAILABLE" },
				});
			}).pipe(Effect.provide(f.layer));
		},
	);

	for (const action of ["start", "recover", "write"] as const) {
		it.scoped(
			`retries ${action} after its initial save fails without a stranded worker state`,
			() => {
				let fail = false;
				const f = firmwareFixture({ failSave: () => fail });
				return Effect.gen(function* () {
					const service = yield* FirmwareUpdates;
					if (action === "write") {
						yield* service.recover("chosen");
						yield* flush;
					}
					const before = yield* service.snapshot();
					const invoke = () =>
						action === "recover"
							? service.recover("chosen")
							: action === "write"
								? service.write("second")
								: service.start();
					fail = true;
					const result = yield* invoke().pipe(Effect.either);
					expect(result._tag).toBe("Left");
					if (result._tag === "Left")
						expect(result.left.code).toBe("QUAKE.FIRMWARE.PERSIST_FAILED");
					expect(yield* service.snapshot()).toEqual(before);
					expect(f.calls).toEqual([]);
					fail = false;
					yield* invoke();
					yield* flush;
					if (action !== "write") yield* service.write("second");
					yield* TestClock.adjust(firmwareTiming.settle);
					yield* flush;
					expect((yield* service.snapshot()).state).toBe("success");
					expect(f.calls.filter((call) => call.startsWith("copy:"))).toEqual([
						"copy:second",
					]);
				}).pipe(Effect.provide(f.layer));
			},
		);
	}
	for (const stage of [
		"entering_download_mode",
		"waiting_volume",
		"ready_to_write",
		"written_unverified",
		"verifying",
		"success",
	] as const) {
		it.scoped(
			`worker save failure at ${stage} reaches a recoverable terminal state even if terminal persistence also fails`,
			() => {
				let failed = false;
				const f = firmwareFixture({
					failSave: (state) => {
						failed ||= state.state === stage;
						return failed;
					},
				});
				return Effect.gen(function* () {
					const service = yield* FirmwareUpdates;
					yield* service.start();
					yield* flush;
					const afterCopy = [
						"written_unverified",
						"verifying",
						"success",
					].includes(stage);
					if (afterCopy) {
						yield* service.write("first");
						yield* TestClock.adjust(firmwareTiming.settle);
						yield* flush;
					}
					const snapshot = yield* service.snapshot();
					expect(snapshot.state).toBe(afterCopy ? "needs_recovery" : "failed");
					expect(snapshot.reason).toBe("QUAKE.FIRMWARE.PERSIST_FAILED");
					expect(
						f.calls.filter((call) => call.startsWith("copy:")),
					).toHaveLength(afterCopy ? 1 : 0);
				}).pipe(Effect.provide(f.layer));
			},
		);
	}

	it.scoped(
		"recovers an already mounted bootloader without live HID or another DFU command",
		() => {
			const f = firmwareFixture({ offline: true });
			return Effect.gen(function* () {
				const service = yield* FirmwareUpdates;
				expect((yield* service.start().pipe(Effect.either))._tag).toBe("Left");
				yield* service.recover("chosen");
				yield* flush;
				expect((yield* service.snapshot()).state).toBe("ready_to_write");
				expect(f.calls).toEqual([]);
				yield* service.write("second");
				yield* TestClock.adjust(firmwareTiming.settle);
				yield* flush;
				expect(f.calls).toEqual(["copy:second", "version:chosen"]);
				expect((yield* service.snapshot()).state).toBe("success");
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.scoped(
		"a selection change during confirmation cannot redirect DFU",
		() => {
			const f = firmwareFixture();
			return Effect.gen(function* () {
				const service = yield* FirmwareUpdates;
				const result = yield* service
					.start({ serial: "other", session: "other-session" })
					.pipe(Effect.either);
				expect(result._tag).toBe("Left");
				expect(f.calls).toEqual([]);
				expect((yield* service.snapshot()).state).toBe("idle");
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.scoped(
		"continues after close, rejects duplicate start, asks which volume, and re-queries only intended serial",
		() => {
			const f = firmwareFixture();
			return Effect.gen(function* () {
				const service = yield* FirmwareUpdates;
				yield* service.start();
				yield* service.close();
				yield* flush;
				expect((yield* service.snapshot()).state).toBe("ready_to_write");
				expect((yield* service.snapshot()).volumes).toHaveLength(2);
				expect((yield* service.start().pipe(Effect.either))._tag).toBe("Left");
				expect(f.calls.filter((x) => x.startsWith("enter:"))).toEqual([
					"enter:chosen",
				]);
				yield* service.write("second");
				yield* TestClock.adjust(firmwareTiming.settle);
				yield* flush;
				expect(f.calls).toEqual([
					"version:chosen",
					"enter:chosen",
					"copy:second",
					"version:chosen",
				]);
				expect((yield* service.snapshot()).state).toBe("success");
				yield* TestClock.adjust(firmwareTiming.ttl);
				expect((yield* service.snapshot()).state).toBe("idle");
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.scoped("cancel before copy writes nothing", () => {
		const f = firmwareFixture();
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* flush;
			yield* s.cancel();
			expect((yield* s.snapshot()).reason).toBe("cancelled_before_write");
			expect(f.calls).toEqual(["enter:chosen"]);
		}).pipe(Effect.provide(f.layer));
	});
	it.scoped("partial copy never retries or reports success", () => {
		const f = firmwareFixture({ copyFails: true });
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* flush;
			yield* s.write("first");
			yield* TestClock.adjust(firmwareTiming.settle);
			yield* flush;
			expect((yield* s.snapshot()).state).toBe("needs_recovery");
			expect(f.calls.filter((x) => x.startsWith("copy:"))).toHaveLength(1);
			expect(f.calls.some((x) => x.startsWith("version:"))).toBe(false);
		}).pipe(Effect.provide(f.layer));
	});
	it.scoped("different version fails verification", () => {
		const f = firmwareFixture({ version: "1.0.19" });
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* flush;
			yield* s.write("first");
			yield* TestClock.adjust(firmwareTiming.settle);
			yield* flush;
			expect((yield* s.snapshot()).reason).toBe("version_mismatch");
			expect((yield* s.snapshot()).state).toBe("needs_recovery");
		}).pipe(Effect.provide(f.layer));
	});
	it.scoped("volume timeout is 90s with no automatic DFU resend", () => {
		const f = firmwareFixture({ volume: false });
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* TestClock.adjust(90001);
			expect((yield* s.snapshot()).reason).toBe("dfu_volume_timeout");
			expect(f.calls).toEqual(["enter:chosen"]);
		}).pipe(Effect.provide(f.layer));
	});
	it.scoped("restart never resumes a write", () => {
		const f = firmwareFixture({ restart: true });
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			expect((yield* s.snapshot()).state).toBe("needs_recovery");
			expect(f.calls).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	});
	it.scoped("copy alone remains unverified through timeout", () => {
		const f = firmwareFixture({ unknown: true });
		return Effect.gen(function* () {
			const s = yield* FirmwareUpdates;
			yield* s.start();
			yield* flush;
			yield* s.write("first");
			yield* TestClock.adjust(2501);
			expect((yield* s.snapshot()).state).toBe("verifying");
			yield* TestClock.adjust(92000);
			expect((yield* s.snapshot()).reason).toBe("verify_timeout");
		}).pipe(Effect.provide(f.layer));
	});
});
const release: AppRelease = {
	app: "open-quake",
	version: "1.1.0",
	platform: "darwin",
	arch: "arm64",
	sha256: "a".repeat(64),
	bytes: 64,
	artifact: "fake:installer",
};
describe("owned app update schedule", () => {
	it.scoped(
		"keeps a 12-hour cadence after the initial five-second check",
		() => {
			const checks: number[] = [];
			return Effect.gen(function* () {
				yield* AppUpdates;
				yield* TestClock.adjust(5000);
				expect(checks).toHaveLength(1);
				yield* TestClock.adjust(appUpdateTiming.interval - 1);
				expect(checks).toHaveLength(1);
				yield* TestClock.adjust(1);
				expect(checks).toHaveLength(2);
			}).pipe(
				Effect.provide(
					AppUpdates.Default.pipe(
						Layer.provide(
							Layer.succeed(AppUpdatePort, {
								enabled: true,
								currentVersion: "1.0.0",
								platform: "darwin",
								arch: "arm64",
								check: () =>
									Effect.sync(() => {
										checks.push(1);
										return Option.none();
									}),
								download: () => Effect.void,
								install: () => Effect.void,
							}),
						),
					),
				),
			);
		},
	);

	it.scoped(
		"checks after 5s, downloads silently, remains single flight, and checks at 12h after defer",
		() =>
			Effect.gen(function* () {
				const download = yield* Deferred.make<void>();
				const calls: string[] = [];
				const layer = AppUpdates.Default.pipe(
					Layer.provide(
						Layer.succeed(AppUpdatePort, {
							enabled: true,
							currentVersion: "1.0.0",
							platform: "darwin",
							arch: "arm64",
							check: () =>
								Effect.sync(() => {
									calls.push("check");
									return Option.some(release);
								}),
							download: (_, progress) =>
								Effect.gen(function* () {
									calls.push("download");
									progress(0.5);
									yield* Deferred.await(download);
								}),
							install: () =>
								Effect.sync(() => {
									calls.push("install");
								}),
						}),
					),
				);
				yield* Effect.gen(function* () {
					const s = yield* AppUpdates;
					yield* TestClock.adjust(4999);
					expect(calls).toEqual([]);
					yield* TestClock.adjust(1);
					expect(calls).toEqual(["check", "download"]);
					expect((yield* s.snapshot()).prompt).toBe(false);
					yield* s.check();
					expect(calls).toHaveLength(2);
					yield* Deferred.succeed(download, undefined);
					yield* flush;
					expect((yield* s.snapshot()).state).toBe("ready");
					yield* s.defer();
					expect((yield* s.snapshot()).prompt).toBe(false);
					yield* s.check();
					expect((yield* s.snapshot()).prompt).toBe(true);
					expect(calls).toEqual(["check", "download"]);
					yield* s.install();
					expect(calls.at(-1)).toBe("install");
				}).pipe(Effect.provide(layer));
			}),
	);
	it.scoped(
		"manual check offers download and rejects another app/platform",
		() => {
			let matching = false;
			const layer = AppUpdates.Default.pipe(
				Layer.provide(
					Layer.succeed(AppUpdatePort, {
						enabled: true,
						currentVersion: "1.0.0",
						platform: "darwin",
						arch: "arm64",
						check: () =>
							Effect.succeed(
								Option.some({
									...release,
									platform: matching ? "darwin" : "linux",
								}),
							),
						download: () => Effect.void,
						install: () => Effect.void,
					}),
				),
			);
			return Effect.gen(function* () {
				const s = yield* AppUpdates;
				expect((yield* s.check().pipe(Effect.either))._tag).toBe("Left");
				expect((yield* s.snapshot()).state).toBe("failed");
				matching = true;
				yield* s.check();
				expect((yield* s.snapshot()).state).toBe("available");
				yield* s.download();
				expect((yield* s.snapshot()).state).toBe("ready");
			}).pipe(Effect.provide(layer));
		},
	);
	it.scoped("disposed scheduler never checks", () =>
		Effect.gen(function* () {
			let count = 0;
			const f = yield* Effect.scoped(
				Effect.gen(function* () {
					yield* AppUpdates;
					yield* TestClock.adjust(1000);
				}),
			).pipe(
				Effect.provide(
					AppUpdates.Default.pipe(
						Layer.provide(
							Layer.succeed(AppUpdatePort, {
								enabled: true,
								currentVersion: "1.0.0",
								platform: "darwin",
								arch: "arm64",
								check: () =>
									Effect.sync(() => {
										count++;
										return Option.none();
									}),
								download: () => Effect.fail(new AppUpdateFailed()),
								install: () => Effect.void,
							}),
						),
					),
				),
				Effect.fork,
			);
			yield* Fiber.join(f);
			yield* TestClock.adjust(appUpdateTiming.interval);
			expect(count).toBe(0);
		}),
	);
});
describe("clear data", () => {
	it.scoped("propagates the main-owned reset failure", () =>
		Effect.gen(function* () {
			const reset = yield* DataReset;
			const result = yield* reset.run(false).pipe(Effect.either);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left")
				expect(result.left.code).toBe("QUAKE.SETTINGS.RESET_FAILED");
		}).pipe(
			Effect.provide(
				DataReset.Default.pipe(
					Layer.provide(
						Layer.succeed(ResetPort, {
							backup: () => Effect.succeed(true),
							confirmFailure: () => Effect.succeed(false),
							resetAndQuit: () => Effect.fail(new ResetFailed()),
						}),
					),
				),
			),
		),
	);
	it.scoped(
		"backup deadline interrupts backup and decline preserves data",
		() =>
			Effect.gen(function* () {
				const calls: string[] = [];
				const layer = DataReset.Default.pipe(
					Layer.provide(
						Layer.succeed(ResetPort, {
							backup: () =>
								Effect.never.pipe(
									Effect.onInterrupt(() =>
										Effect.sync(() => {
											calls.push("backup-stopped");
										}),
									),
								),
							confirmFailure: () =>
								Effect.sync(() => {
									calls.push("confirm");
									return false;
								}),
							resetAndQuit: () =>
								Effect.sync(() => {
									calls.push("reset");
								}),
						}),
					),
				);
				yield* Effect.gen(function* () {
					const s = yield* DataReset;
					const f = yield* s.run(true).pipe(Effect.fork);
					yield* TestClock.adjust(60000);
					expect(yield* Fiber.join(f)).toBe(false);
					expect(calls).toEqual(["backup-stopped", "confirm"]);
				}).pipe(Effect.provide(layer));
			}),
	);
	it.scoped("explicit failure override starts the main-owned reset", () => {
		const calls: string[] = [];
		const layer = DataReset.Default.pipe(
			Layer.provide(
				Layer.succeed(ResetPort, {
					backup: () => Effect.fail(new BackupFailed()),
					confirmFailure: () =>
						Effect.sync(() => {
							calls.push("confirm");
							return true;
						}),
					resetAndQuit: () =>
						Effect.sync(() => {
							calls.push("reset");
						}),
				}),
			),
		);
		return Effect.gen(function* () {
			const s = yield* DataReset;
			expect(yield* s.run(true)).toBe(true);
			expect(calls).toEqual(["confirm", "reset"]);
		}).pipe(Effect.provide(layer));
	});

	it("catalog errors retain private cause and scrub sensitive diagnostics", () => {
		const cause = new Error("/Volumes/private?token=secret");
		const error = new FirmwareWriteFailed(cause);
		expect(error.originalCause).toBe(cause);
		expect(error.code).toBe(MaintenanceErrors.FirmwareWriteFailed.code);
		expect(JSON.stringify(error)).not.toMatch(/Volumes|token|secret/);
	});
});

it("acquires firmware without reading and retries before cancel without losing interrupted recovery", async () => {
	let broken = true;
	let reads = 0;
	const error = new FirmwarePersistenceFailed();
	const f = firmwareFixture({
		load: () =>
			Effect.suspend(() => {
				reads++;
				return broken
					? Effect.fail(error)
					: Effect.succeed({
							...idleFirmware,
							state: "copying",
							serial: "chosen",
						});
			}),
	});
	const runtime = ManagedRuntime.make(f.layer);
	try {
		await runtime.runtime();
		expect(reads).toBe(0);
		expect(
			await runtime.runPromise(
				Effect.flatMap(FirmwareUpdates, (s) => Effect.either(s.cancel())),
			),
		).toMatchObject({ _tag: "Left", left: error });
		expect(f.records).toEqual([]);
		broken = false;
		const states = await Promise.all(
			Array.from({ length: 8 }, () =>
				runtime.runPromise(
					Effect.flatMap(FirmwareUpdates, (s) => s.snapshot()),
				),
			),
		);
		expect(
			states.every(
				(s) => s.state === "needs_recovery" && s.reason === "interrupted",
			),
		).toBe(true);
		expect(reads).toBe(2);
		expect(f.records).toEqual([]);
	} finally {
		await runtime.dispose();
	}
});

import { it as effectIt } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	TestClock,
} from "effect";
import { describe, expect, it } from "vitest";
import { GeneralSettingsService } from "../../../../../packages/edge/src/settings/general-service";
import { SettingsOsPort } from "../../../../../packages/edge/src/settings/settings-ports";
import { SettingsStorage } from "../../../../../packages/edge/src/settings/settings-repository";
import { createSettingsOsAdapter, type SettingsNativeApi } from "./os-adapter";

const initial = { version: 1 as const, locale: "en" as const, revision: 0 };
const native = (
	changes: Partial<SettingsNativeApi> = {},
): SettingsNativeApi => ({
	loginSupported: true,
	getLoginItemSettings: async () => ({ openAtLogin: false }),
	setLoginItemSettings: async () => {},
	workAreas: async () => [{ x: 0, y: 0, width: 1920, height: 1080 }],
	managementReachable: async () => false,
	...changes,
});
function runtime(api: SettingsNativeApi) {
	return ManagedRuntime.make(
		GeneralSettingsService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(SettingsStorage, {
						osLocale: "en",
						read: Effect.succeed(Option.some(initial)),
						write: () => Effect.void,
					}),
					Layer.succeed(SettingsOsPort, createSettingsOsAdapter(api)),
				),
			),
		),
	);
}
describe("desktop OS settings boundary through the general conductor", () => {
	it("passes only login intent to the OS, then checks readback without conflating hidden start", async () => {
		let enabled = false;
		const applied: unknown[] = [];
		const r = runtime(
			native({
				getLoginItemSettings: async () => ({ openAtLogin: enabled }),
				setLoginItemSettings: async (settings) => {
					applied.push(settings);
					enabled = settings.openAtLogin;
				},
			}),
		);
		try {
			await r.runPromise(GeneralSettingsService.save({ startHidden: true }));
			expect(applied).toEqual([]);
			await r.runPromise(GeneralSettingsService.save({ launchAtLogin: true }));
			expect(applied).toEqual([{ openAtLogin: true }]);
			expect(await r.runPromise(GeneralSettingsService.loginStatus())).toBe(
				true,
			);
		} finally {
			await r.dispose();
		}
	});
	it("does no native work on construction or unsupported login writes", async () => {
		let calls = 0;
		const r = runtime(
			native({
				loginSupported: false,
				setLoginItemSettings: async () => {
					calls++;
				},
			}),
		);
		try {
			await r.runPromise(GeneralSettingsService.snapshot());
			expect(calls).toBe(0);
			expect(
				await r.runPromise(
					Effect.either(GeneralSettingsService.save({ launchAtLogin: true })),
				),
			).toMatchObject({
				_tag: "Left",
				left: { code: "QUAKE.SETTINGS.OS_APPLY_FAILED", reason: "unsupported" },
			});
			expect(calls).toBe(0);
		} finally {
			await r.dispose();
		}
	});
	it("retains denied-write cause privately and rejects a successful call with mismatched readback", async () => {
		const cause = Object.assign(new Error("secret=do-not-log"), {
			code: "EPERM",
		});
		const r = runtime(
			native({
				setLoginItemSettings: async () => {
					throw cause;
				},
			}),
		);
		try {
			const result = await r.runPromise(
				Effect.either(GeneralSettingsService.save({ launchAtLogin: true })),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: { reason: "denied" },
			});
			if (result._tag === "Left") {
				expect(result.left.originalCause).toBe(cause);
				expect(JSON.stringify(result.left)).not.toContain("do-not-log");
			}
		} finally {
			await r.dispose();
		}
		const mismatch = runtime(native());
		try {
			expect(
				await mismatch.runPromise(
					Effect.either(GeneralSettingsService.save({ launchAtLogin: true })),
				),
			).toMatchObject({ _tag: "Left", left: { reason: "unverified" } });
		} finally {
			await mismatch.dispose();
		}
	});
	it("treats failed reachability probes as visible startup and rejects malformed work areas", async () => {
		const r = runtime(
			native({
				managementReachable: async () => {
					throw new Error("no tray");
				},
				workAreas: async () => [{ x: 0, y: 0, width: 0, height: 1080 }],
			}),
		);
		try {
			await r.runPromise(GeneralSettingsService.save({ startHidden: true }));
			expect(await r.runPromise(GeneralSettingsService.startup())).toEqual({
				hidden: false,
			});
			await r.runPromise(
				GeneralSettingsService.save({
					window: { x: 0, y: 0, width: 1200, height: 800 },
				}),
			);
			expect(
				await r.runPromise(Effect.either(GeneralSettingsService.startup())),
			).toMatchObject({
				_tag: "Left",
				left: { _tag: "SettingsOsApplyFailed" },
			});
		} finally {
			await r.dispose();
		}
	});
	effectIt.effect(
		"bounds a stalled OS read and aborts its signal without waiting on native completion",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				let aborted = false;
				const adapter = createSettingsOsAdapter(
					native({
						getLoginItemSettings: (signal) =>
							new Promise(() => {
								signal.addEventListener("abort", () => {
									aborted = true;
								});
								Effect.runSync(Deferred.succeed(entered, undefined));
							}),
					}),
				);
				const fiber = yield* Effect.fork(adapter.login().pipe(Effect.either));
				yield* Deferred.await(entered);
				yield* TestClock.adjust("2 seconds");
				expect(yield* Fiber.join(fiber)).toMatchObject({
					_tag: "Left",
					left: { reason: "timeout" },
				});
				expect(aborted).toBe(true);
			}),
	);
	effectIt.effect("cancellation aborts an active native request", () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			let aborted = false;
			const adapter = createSettingsOsAdapter(
				native({
					setLoginItemSettings: (_settings, signal) =>
						new Promise(() => {
							signal.addEventListener("abort", () => {
								aborted = true;
							});
							Effect.runSync(Deferred.succeed(entered, undefined));
						}),
				}),
			);
			const fiber = yield* Effect.fork(adapter.setLogin(true));
			yield* Deferred.await(entered);
			yield* Fiber.interrupt(fiber);
			expect(aborted).toBe(true);
		}),
	);
});

it("cancels an OS application through the conductor without rolling back or confirming saved intent", async () => {
	const entered = await Effect.runPromise(Deferred.make<void>());
	let aborted = false;
	const r = runtime(
		native({
			setLoginItemSettings: (_settings, signal) =>
				new Promise(() => {
					signal.addEventListener("abort", () => {
						aborted = true;
					});
					Effect.runSync(Deferred.succeed(entered, undefined));
				}),
		}),
	);
	try {
		const fiber = r.runFork(
			GeneralSettingsService.save({ launchAtLogin: true }),
		);
		await Effect.runPromise(Deferred.await(entered));
		await Effect.runPromise(Fiber.interrupt(fiber));
		expect(aborted).toBe(true);
		expect(await r.runPromise(GeneralSettingsService.snapshot())).toMatchObject(
			{ launchAtLogin: true },
		);
		expect(await r.runPromise(GeneralSettingsService.loginStatus())).toBe(
			false,
		);
	} finally {
		await r.dispose();
	}
});

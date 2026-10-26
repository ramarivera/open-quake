import { describe, expect, it } from "@effect/vitest";
import { Effect, TestClock } from "effect";
import type { Display } from "electron";
import { vi } from "vitest";
import type { ConnectionDiagnostic } from "../../shared/lifecycle-contracts";
import { makeDisplay } from "../test/display";
import { DeviceLifecycle } from "./lifecycle-service";
import { DisplayOperationFailed } from "./native-display";

const primary = makeDisplay();
const strip = makeDisplay({
	id: 2,
	label: "Unidentified strip",
	size: { width: 1920, height: 480 },
});
// A layer's scope must surround every consumer, including its TestClock advances.
const withLifecycle = (
	development: boolean,
	test: (
		service: DeviceLifecycle,
		panels: { id: number | undefined; visible: boolean; fallback: boolean }[],
		setDisplays: (ds: readonly Display[]) => void,
	) => Effect.Effect<void>,
) =>
	Effect.gen(function* () {
		let displays: readonly Display[] = [primary, strip];
		const panels: {
			id: number | undefined;
			visible: boolean;
			fallback: boolean;
		}[] = [];
		yield* Effect.gen(function* () {
			yield* test(yield* DeviceLifecycle, panels, (ds) => {
				displays = ds;
			});
		}).pipe(
			Effect.provide(
				DeviceLifecycle.Default({
					development,
					mock: true,
					displays: () => displays,
					watch: () => () => {},
					bus: () => undefined,
					notify: () => {},
					panel: (display, visible, fallback) => {
						panels.push({ id: display?.id, visible, fallback });
					},
					prompts: {
						platform: "darwin",
						mock: true,
						displays: () => displays,
						primaryId: () => 1,
						prompt: () => Effect.die("mock must not prompt"),
						openSettings: () => Effect.void,
						native: () => Effect.die("mock must not call native"),
					},
				}),
			),
		);
	});
const withRealPairing = (
	initial: readonly Display[],
	test: (h: {
		service: DeviceLifecycle;
		power: boolean[];
		notices: ConnectionDiagnostic[];
		change: (next: readonly Display[]) => Effect.Effect<void>;
		onPower: (react: (on: boolean) => Effect.Effect<void>) => void;
	}) => Effect.Effect<void>,
) =>
	Effect.gen(function* () {
		let displays = initial;
		const listeners = new Set<() => void>();
		const power: boolean[] = [];
		const notices: ConnectionDiagnostic[] = [];
		let service: DeviceLifecycle | undefined;
		let react = (_on: boolean): Effect.Effect<void> => Effect.void;
		const change = (next: readonly Display[]) =>
			Effect.gen(function* () {
				displays = next;
				for (const listener of listeners) listener();
				if (service) yield* service.topology();
			});
		yield* Effect.gen(function* () {
			service = yield* DeviceLifecycle;
			yield* test({
				service,
				power,
				notices,
				change,
				onPower: (next) => {
					react = next;
				},
			});
		}).pipe(
			Effect.provide(
				DeviceLifecycle.Default({
					development: false,
					mock: false,
					displays: () => displays,
					watch: (listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					bus: () => ({
						on: () => () => {},
						currentStatus: () => undefined,
						setScreenPower: (on) =>
							Effect.gen(function* () {
								power.push(on);
								yield* react(on);
								return true;
							}),
					}),
					notify: (status) => notices.push(status),
					panel: () => {},
					prompts: {
						platform: "linux",
						mock: true,
						displays: () => displays,
						primaryId: () => primary.id,
						prompt: () => Effect.die("must not prompt"),
						openSettings: () => Effect.void,
						native: () => Effect.die("must not call native"),
					},
				}),
			),
		);
	});
const connected = {
	source: "hid",
	kind: "status",
	state: "connected",
} as const;
describe("desktop lifecycle", () => {
	it.scoped(
		"starts the known DK-QUAKE without a power-cycle display event",
		() =>
			withRealPairing([primary, { ...strip, label: "DK-QUAKE" }], (h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus({
						source: "hid",
						kind: "status",
						state: "connected",
					});
					yield* TestClock.adjust(1);
					expect(h.power).toEqual([]);
					expect(h.service.status()).toMatchObject({
						usb: "pass",
						hdmi: "pass",
						checking: false,
						issue: "none",
					});
				}),
			),
	);

	it.scoped(
		"never publishes real-device readiness before an initial pairing times out",
		() =>
			withRealPairing([primary, strip], (h) =>
				Effect.gen(function* () {
					expect(h.service.status().hdmi).toBe("fail");
					yield* h.service.onStatus(connected);
					yield* TestClock.adjust(30_000);
					expect(
						h.notices.some(
							(s) => s.usb === "pass" && s.hdmi === "pass" && !s.checking,
						),
					).toBe(false);
					expect(h.service.status()).toMatchObject({
						hdmi: "fail",
						checking: false,
						issue: "timeout",
					});
					h.onPower((on) => h.change(on ? [primary, strip] : [primary]));
					yield* h.service.redetect(false);
					expect(h.service.status()).toMatchObject({
						hdmi: "pass",
						checking: false,
						issue: "none",
					});
				}),
			),
	);
	it.scoped(
		"does not blank before HDMI and binds on its later arrival without Re-detect",
		() =>
			withRealPairing([primary], (h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus(connected);
					yield* TestClock.adjust(1);
					expect(h.power).toEqual([]);
					expect(h.service.status()).toMatchObject({
						usb: "pass",
						hdmi: "fail",
						checking: false,
						issue: "unavailable",
					});
					h.onPower((on) => h.change(on ? [primary, strip] : [primary]));
					yield* h.change([primary, strip]);
					yield* TestClock.adjust(1);
					expect(h.power).toEqual([false, true]);
					expect(h.service.status()).toMatchObject({
						hdmi: "pass",
						checking: false,
						issue: "none",
					});
				}),
			),
	);
	it.scoped(
		"retries changed candidates after an in-flight timeout and does not loop on its own off/on edges",
		() => {
			const decoy = makeDisplay({ ...strip, id: 3 });
			return withRealPairing([primary, decoy], (h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus(connected);
					yield* TestClock.adjust(5000);
					expect(h.power).toEqual([false]);
					yield* h.change([primary, decoy, strip]);
					expect(h.service.status().checking).toBe(true);
					h.onPower((on) =>
						h.change(on ? [primary, decoy, strip] : [primary, decoy]),
					);
					yield* TestClock.adjust(25_000);
					expect(h.power).toEqual([false, true, false, true]);
					expect(h.service.status()).toMatchObject({
						hdmi: "pass",
						checking: false,
						issue: "none",
					});
					yield* TestClock.adjust(60_000);
					expect(h.power).toEqual([false, true, false, true]);
				}),
			);
		},
	);
	it.scoped(
		"does not repeat a timed-out transaction when restore reports unchanged candidates",
		() =>
			withRealPairing([primary, strip], (h) =>
				Effect.gen(function* () {
					h.onPower(() => h.change([primary, strip]));
					yield* h.service.onStatus(connected);
					yield* TestClock.adjust(90_000);
					expect(h.power).toEqual([false, true]);
					expect(h.service.status()).toMatchObject({
						hdmi: "fail",
						checking: false,
						issue: "timeout",
					});
				}),
			),
	);

	it.scoped(
		"publishes a safe layout failure, keeps polling through cooldown and clears it after explicit repair",
		() =>
			Effect.gen(function* () {
				const error = new DisplayOperationFailed(
					new Error("token=secret /private/native"),
				);
				const notices: ConnectionDiagnostic[] = [];
				const prompt = vi.fn(() => Effect.succeed(0));
				let broken = true;
				yield* Effect.gen(function* () {
					const service = yield* DeviceLifecycle;
					yield* TestClock.adjust(1000);
					expect(service.status().issue).toBe("native-failed");
					expect(notices.at(-1)?.issue).toBe("native-failed");
					expect(JSON.stringify(notices)).not.toContain("secret");
					expect(JSON.stringify(notices)).not.toContain("/private/native");
					yield* TestClock.adjust(599_999);
					expect(prompt).toHaveBeenCalledOnce();
					yield* TestClock.adjust(1);
					expect(prompt).toHaveBeenCalledTimes(2);
					const failure = yield* Effect.flip(service.repair());
					expect(failure._tag).toBe("DisplayOperationFailed");
					expect(failure.code).toBe(error.code);
					expect(failure.originalCause).toBe(error.originalCause);
					broken = false;
					yield* service.repair();
					expect(prompt).toHaveBeenCalledTimes(4);
					expect(service.status().issue).toBe("none");
					expect(notices.at(-1)?.issue).toBe("none");
				}).pipe(
					Effect.provide(
						DeviceLifecycle.Default({
							development: false,
							mock: true,
							displays: () => [primary, strip],
							watch: () => () => {},
							bus: () => undefined,
							panel: () => {},
							notify: (status) => notices.push(status),
							prompts: {
								platform: "darwin",
								mock: false,
								displays: () => [primary, strip],
								primaryId: () => primary.id,
								prompt,
								openSettings: () => Effect.void,
								native: (action) =>
									action === "probe"
										? Effect.succeed("mirrored")
										: broken
											? Effect.fail(error)
											: Effect.succeed("applied"),
							},
						}),
					),
				);
			}),
	);
	it.scoped(
		"keeps HDMI failed after pairing times out, then admits settings after a successful retry",
		() =>
			Effect.gen(function* () {
				let displays: readonly Display[] = [primary, strip];
				let changed = (): void => {};
				let responds = false;
				const power: boolean[] = [];
				const panels: boolean[] = [];
				yield* Effect.gen(function* () {
					const service = yield* DeviceLifecycle;
					yield* service.onStatus({
						source: "hid",
						kind: "status",
						state: "connected",
					});
					yield* TestClock.adjust(30_000);
					expect(power).toEqual([false, true]);
					expect(service.status()).toMatchObject({
						usb: "pass",
						hdmi: "fail",
						checking: false,
						issue: "timeout",
					});
					expect(panels.at(-1)).toBe(false);
					responds = true;
					const retried = yield* service.redetect();
					expect(retried).toMatchObject({
						usb: "pass",
						hdmi: "pass",
						checking: false,
						issue: "none",
					});
					expect(power).toEqual([false, true, false, true]);
					expect(panels.at(-1)).toBe(true);
				}).pipe(
					Effect.provide(
						DeviceLifecycle.Default({
							development: false,
							mock: false,
							displays: () => displays,
							watch: (listener) => {
								changed = listener;
								return () => {};
							},
							bus: () => ({
								on: () => () => {},
								currentStatus: () => undefined,
								setScreenPower: (on) =>
									Effect.sync(() => {
										power.push(on);
										if (responds) displays = on ? [primary, strip] : [primary];
										changed();
										return true;
									}),
							}),
							notify: () => {},
							panel: (_display, visible) => panels.push(visible),
							prompts: {
								platform: "linux",
								mock: true,
								displays: () => displays,
								primaryId: () => primary.id,
								prompt: () => Effect.die("must not prompt"),
								openSettings: () => Effect.void,
								native: () => Effect.die("must not call native"),
							},
						}),
					),
				);
			}),
	);
	it.scoped(
		"hides immediately and reuses the strip during a three-second USB grace",
		() =>
			withLifecycle(true, (service, panels) =>
				Effect.gen(function* () {
					yield* service.onStatus({
						source: "mock",
						kind: "status",
						state: "connected",
					});
					yield* service.onStatus({
						source: "mock",
						kind: "status",
						state: "disconnected",
						reason: "error",
					});
					expect(panels.at(-1)).toEqual({
						id: 2,
						visible: false,
						fallback: false,
					});
					yield* TestClock.adjust(2999);
					yield* service.onStatus({
						source: "mock",
						kind: "status",
						state: "connected",
					});
					expect(panels.at(-1)).toEqual({
						id: 2,
						visible: true,
						fallback: false,
					});
					yield* TestClock.adjust(1);
					expect(panels.at(-1)?.id).toBe(2);
				}),
			),
	);
	for (const dev of [true, false])
		it.scoped(
			`keeps missing-strip fallback ${dev ? "visible in development" : "hidden in release"}`,
			() =>
				withLifecycle(dev, (service, panels, setDisplays) =>
					Effect.gen(function* () {
						setDisplays([primary]);
						yield* service.topology();
						expect(panels.at(-1)).toEqual({
							id: undefined,
							visible: dev,
							fallback: dev,
						});
					}),
				),
		);
	it.scoped(
		"defers topology while locked and recovers 2500 ms after unlock",
		() =>
			withLifecycle(false, (service, panels, setDisplays) =>
				Effect.gen(function* () {
					yield* service.onStatus({
						source: "mock",
						kind: "status",
						state: "connected",
					});
					yield* service.lock();
					const count = panels.length;
					setDisplays([primary]);
					yield* service.topology();
					expect(panels).toHaveLength(count);
					yield* service.wake(false);
					yield* TestClock.adjust(3000);
					expect(panels).toHaveLength(count);
					yield* service.wake();
					yield* TestClock.adjust(2499);
					expect(panels).toHaveLength(count);
					yield* TestClock.adjust(1);
					expect(panels.at(-1)?.visible).toBe(false);
				}),
			),
	);
});

it.scoped(
	"MGMT-028 derives diagnostics from USB and the paired display in both orientations",
	() =>
		Effect.gen(function* () {
			for (const usb of [false, true]) {
				for (const size of [
					undefined,
					{ width: 1920, height: 480 },
					{ width: 480, height: 1920 },
					{ width: 960, height: 240 },
				]) {
					const display = size
						? makeDisplay({ id: 2, label: "DK-QUAKE", size })
						: undefined;
					const displays = display ? [primary, display] : [primary];
					yield* withRealPairing(displays, (h) =>
						Effect.gen(function* () {
							h.onPower((on) => h.change(on ? displays : [primary]));
							if (usb) {
								yield* h.service.onStatus(connected);
								yield* TestClock.adjust(30_001);
							}
							const correct =
								size !== undefined &&
								(size.width === 1920 || size.width === 480);
							expect(h.service.status()).toMatchObject({
								usb: usb ? "pass" : "fail",
								hdmi: usb && correct ? "pass" : "fail",
								checking: false,
								width: size?.width ?? 0,
								height: size?.height ?? 0,
								resolutionMismatch: size !== undefined && !correct,
							});
							if (usb) expect(h.notices.at(-1)).toEqual(h.service.status());
						}),
					);
				}
			}
		}),
);

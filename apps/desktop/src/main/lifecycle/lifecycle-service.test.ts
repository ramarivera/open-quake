import { describe, expect, it } from "@effect/vitest";
import { Effect, TestClock } from "effect";
import type { Display } from "electron";
import { makeDisplay } from "../test/display";
import { DeviceLifecycle } from "./lifecycle-service";

const primary = makeDisplay();
const strip = makeDisplay({
	id: 2,
	label: "DK-QUAKE",
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
describe("desktop lifecycle", () => {
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

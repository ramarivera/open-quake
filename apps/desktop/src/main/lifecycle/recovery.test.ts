import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, type Scope, TestClock } from "effect";
import type { Display } from "electron";
import { vi } from "vitest";
import type { ConnectionDiagnostic } from "../../shared/lifecycle-contracts";
import { makeDisplay } from "../test/display";
import { DeviceLifecycle, type LifecycleEdges } from "./lifecycle-service";
import { DisplayOperationFailed } from "./native-display";
import { planRecovery } from "./recovery-plan";

const desktop = makeDisplay();
const a = makeDisplay({
	id: 2,
	label: "DK-QUAKE",
	size: { width: 1920, height: 480 },
	bounds: { x: 2560, y: 0, width: 1920, height: 480 },
});
const b = makeDisplay({
	...a,
	id: 3,
	bounds: { x: -1920, y: 0, width: 1920, height: 480 },
});
const connected = {
	source: "hid",
	kind: "status",
	state: "connected",
} as const;
function withHarness(
	test: (h: {
		service: DeviceLifecycle;
		change: (
			ds: readonly Display[],
			metrics?: readonly string[],
		) => Effect.Effect<void>;
		panels: {
			serial: string | undefined;
			id: number | undefined;
			display: Display | undefined;
			visible: boolean;
		}[];
		dispose: ReturnType<typeof vi.fn>;
		recover: ReturnType<typeof vi.fn>;
		notices: ConnectionDiagnostic[];
		power: string[];
		alert: ReturnType<typeof vi.fn>;
	}) => Effect.Effect<void, never, Scope.Scope>,
	overrides: Partial<LifecycleEdges> = {},
) {
	return Effect.gen(function* () {
		let displays: readonly Display[] = [desktop, a, b];
		const listeners = new Set<() => void>();
		const panels: {
			serial: string | undefined;
			id: number | undefined;
			display: Display | undefined;
			visible: boolean;
		}[] = [];
		const notices: ConnectionDiagnostic[] = [];
		const dispose = vi.fn();
		const recover = vi.fn(() => Effect.void);
		const power: string[] = [];
		const alert = vi.fn();
		const edges: LifecycleEdges = {
			alert,
			development: false,
			mock: false,
			displays: () => displays,
			bus: () => undefined,
			busFor: (serial) => ({
				on: () => () => {},
				currentStatus: () => undefined,
				recover,
				setScreenPower: (on) =>
					Effect.sync(() => {
						power.push(`${serial}:${on}`);
						displays = on ? [desktop, a, b] : [desktop, serial === "a" ? b : a];
						for (const listener of listeners) listener();
						return true;
					}),
			}),
			watch: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			panel: (display, visible, _fallback, serial) =>
				panels.push({ serial, id: display?.id, display, visible }),
			notify: (status) => notices.push(status),
			disposePanel: dispose,
			prompts: {
				platform: "linux",
				mock: true,
				displays: () => displays,
				primaryId: () => 1,
				prompt: () => Effect.succeed(1),
				native: () => Effect.succeed("extended"),
				openSettings: () => Effect.void,
			},
			...overrides,
		};
		yield* Effect.gen(function* () {
			const service = yield* DeviceLifecycle;
			yield* test({
				service,
				change: (ds, metrics) =>
					Effect.gen(function* () {
						displays = ds;
						for (const listener of listeners) listener();
						yield* service.topology(metrics);
					}),
				panels,
				dispose,
				recover,
				notices,
				power,
				alert,
			});
		}).pipe(Effect.provide(DeviceLifecycle.Default(edges)));
	});
}
describe("stable recovery planner", () => {
	it("MAIN-047 reserves IDs, stable bounds and sole remaining candidates without reusing a desktop ID", () => {
		const moved = { ...a, id: 9 };
		const reused = makeDisplay({ id: 2 });
		const plan = planRecovery(
			[
				{ serial: "a", displayId: 2, bounds: a.bounds },
				{ serial: "b", displayId: 3, bounds: b.bounds },
			],
			[reused, b, moved],
		);
		expect([...plan.assigned].map(([serial, d]) => [serial, d.id])).toEqual([
			["b", 3],
			["a", 9],
		]);
		expect(plan.unresolved).toEqual([]);
		const unresolved = planRecovery(
			[{ serial: "a" }, { serial: "b" }],
			[desktop, a, b],
		);
		expect(unresolved.assigned.size).toBe(0);
		expect(unresolved.unresolved).toEqual(["a", "b"]);
	});
	it("never resolves duplicate stable claims by iteration order", () => {
		const plan = planRecovery(
			[
				{ serial: "a", displayId: 2, bounds: a.bounds },
				{ serial: "b", displayId: 2, bounds: a.bounds },
			],
			[a, b],
		);
		expect(plan.assigned.size).toBe(0);
	});
});
describe("serial lifecycle consumer", () => {
	it.scoped(
		"uses live bounds and rotation when one strip moves while another is pairing",
		() =>
			withHarness(
				(h) =>
					Effect.gen(function* () {
						yield* h.change([desktop, a]);
						yield* h.service.onStatus(connected, "a");
						yield* TestClock.adjust(1);
						const unidentified = { ...b, label: "Unidentified strip" };
						yield* h.change([desktop, a, unidentified]);
						yield* h.service.onStatus(connected, "b");
						yield* TestClock.adjust(1);
						expect(h.service.status().checking).toBe(true);
						const moved = {
							...a,
							rotation: 90,
							size: { width: 480, height: 1920 },
							bounds: { x: 4000, y: -100, width: 480, height: 1920 },
						};
						yield* h.change([desktop, moved], ["bounds", "rotation"]);
						yield* TestClock.adjust(1);
						yield* h.change([desktop, moved, unidentified]);
						yield* TestClock.adjust(1);
						expect(h.service.status().checking).toBe(false);
						expect(h.service.status().orientations).toContainEqual(
							expect.objectContaining({
								serialNumber: "a",
								rotation: 90,
								isVertical: true,
							}),
						);
						expect(
							h.panels.filter((p) => p.serial === "a" && p.visible).at(-1)
								?.display,
						).toEqual(moved);
					}),
				{
					busFor: () => ({
						on: () => () => {},
						currentStatus: () => undefined,
						setScreenPower: () => Effect.succeed(true),
					}),
				},
			),
	);
	it.scoped(
		"MAIN-046 alerts every serial and sequentially binds only the strip powered by that serial",
		() =>
			withHarness((h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus(connected, "a");
					yield* TestClock.adjust(1);
					yield* h.service.onStatus(connected, "b");
					yield* TestClock.adjust(1);
					expect(
						h.service.status().orientations?.map((o) => o.serialNumber),
					).toEqual(["a", "b"]);
					expect(
						h.panels.filter((p) => p.visible).every((p) => p.id !== desktop.id),
					).toBe(true);
					expect(h.power).toEqual(["a:false", "a:true"]);
				}),
			),
	);
	it.scoped(
		"MAIN-046 publishes the same targeted ambiguity state without guessing",
		() =>
			withHarness(
				(h) =>
					Effect.gen(function* () {
						yield* h.service.onStatus(connected, "a");
						yield* h.service.onStatus(connected, "b");
						yield* TestClock.adjust(1);
						expect(h.service.status().alert).toEqual({
							alertType: "multi-screen",
							deviceSNs: ["a", "b"],
						});
						expect(h.panels.some((p) => p.visible)).toBe(false);
						expect(h.alert).toHaveBeenCalledWith("a", {
							alertType: "multi-screen",
							deviceSNs: ["a", "b"],
						});
						expect(h.alert).toHaveBeenCalledWith("b", {
							alertType: "multi-screen",
							deviceSNs: ["a", "b"],
						});
						yield* TestClock.adjust(30000);
						expect(h.service.status().hdmi).toBe("fail");
					}),
				{
					busFor: () => ({
						on: () => () => {},
						currentStatus: () => undefined,
						setScreenPower: () => Effect.succeed(true),
					}),
				},
			),
	);
	it.scoped(
		"keeps another serial pairing when an already paired device disconnects",
		() =>
			withHarness(
				(h) =>
					Effect.gen(function* () {
						yield* h.change([desktop, a]);
						yield* h.service.onStatus(connected, "a");
						yield* TestClock.adjust(1);
						const unconfirmed = { ...b, label: "Unidentified strip" };
						yield* h.change([desktop, a, unconfirmed]);
						yield* h.service.onStatus(connected, "b");
						yield* TestClock.adjust(1);
						expect(h.service.status().checking).toBe(true);
						yield* h.service.onStatus(
							{
								...connected,
								state: "disconnected",
								reason: "transport-ended",
							},
							"a",
						);
						expect(h.service.status().checking).toBe(true);
						yield* h.change([desktop]);
						yield* TestClock.adjust(1);
						yield* h.change([desktop, unconfirmed]);
						yield* TestClock.adjust(1);
						expect(
							h.service.status().orientations?.map((o) => o.serialNumber),
						).toEqual(["b"]);
						expect(
							h.panels.filter((p) => p.serial === "b").at(-1),
						).toMatchObject({ id: b.id, visible: true });
					}),
				{
					busFor: () => ({
						on: () => () => {},
						currentStatus: () => undefined,
						setScreenPower: () => Effect.succeed(true),
					}),
				},
			),
	);

	for (const swapped of [
		{ ...a, label: "Another strip" },
		{ ...a, bounds: { ...a.bounds, x: a.bounds.x + 100 } },
	])
		it.scoped(
			`parks a grace reconnect when display ${swapped.label !== a.label ? "identity" : "bounds"} changed under the same ID`,
			() =>
				withHarness(
					(h) =>
						Effect.gen(function* () {
							yield* h.change([desktop, a]);
							yield* h.service.onStatus(connected, "a");
							yield* TestClock.adjust(1);
							yield* h.change([desktop, a, b]);
							yield* h.service.onStatus(connected, "b");
							yield* TestClock.adjust(1);
							expect(h.service.status().orientations).toHaveLength(2);
							yield* h.service.onStatus(
								{
									...connected,
									state: "disconnected",
									reason: "transport-ended",
								},
								"a",
							);
							yield* TestClock.adjust(1000);
							yield* h.change([desktop, swapped, b]);
							const before = h.panels.length;
							yield* h.service.onStatus(connected, "a");
							yield* TestClock.adjust(1);
							expect(
								h.panels
									.slice(before)
									.filter((p) => p.serial === "a")
									.every((p) => !p.visible),
							).toBe(true);
							expect(h.service.status()).toMatchObject({
								hdmi: "fail",
								checking: true,
							});
							expect(
								h.service.status().orientations?.map((o) => o.serialNumber),
							).toEqual(["b"]);
						}),
					{
						busFor: () => ({
							on: () => () => {},
							currentStatus: () => undefined,
							setScreenPower: () => Effect.succeed(true),
						}),
					},
				),
		);

	it.scoped(
		"MAIN-053 SCREEN-147 debounces bursts at 1500ms, ignores workArea, and isolates rotated serials",
		() =>
			withHarness((h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus(connected, "a");
					yield* TestClock.adjust(1);
					yield* h.service.onStatus(connected, "b");
					yield* TestClock.adjust(1);
					const initial = h.notices.length;
					yield* h.change([desktop, a, b], ["workArea"]);
					yield* TestClock.adjust(5000);
					expect(h.notices).toHaveLength(initial);
					const portrait = makeDisplay({
						...a,
						size: { width: 480, height: 1920 },
						bounds: { x: 2560, y: 0, width: 480, height: 1920 },
						rotation: 90,
					});
					yield* h.change([desktop, portrait, b], ["rotation"]);
					yield* TestClock.adjust(1000);
					yield* h.change([desktop, portrait, b], ["bounds"]);
					yield* TestClock.adjust(1499);
					expect(
						h.service.status().orientations?.find((o) => o.serialNumber === "a")
							?.isVertical,
					).toBe(true);
					yield* TestClock.adjust(1);
					expect(h.service.status().orientations).toMatchObject([
						{ serialNumber: "a", rotation: 90, isVertical: true },
						{ serialNumber: "b", isVertical: false },
					]);
					yield* h.change([desktop, { ...a, rotation: 270 }, b], ["rotation"]);
					yield* TestClock.adjust(1500);
					expect(
						h.service
							.status()
							.orientations?.find((o) => o.serialNumber === "a"),
					).toMatchObject({
						rotation: 270,
						isVertical: false,
						orientation: "horizontal",
					});
				}),
			),
	);
	it.scoped(
		"MAIN-060 SETTINGS-085 immediately parks every serial, defers while locked and cancels stale wake generations",
		() =>
			withHarness((h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus(connected, "a");
					yield* TestClock.adjust(1);
					yield* h.service.onStatus(connected, "b");
					yield* TestClock.adjust(1);
					yield* h.service.lock();
					const calls = h.panels.length;
					yield* h.service.wake(false);
					yield* TestClock.adjust(10000);
					expect(h.recover).not.toHaveBeenCalled();
					expect(h.panels).toHaveLength(calls);
					yield* h.service.wake();
					expect(h.panels.slice(-2).every((p) => !p.visible)).toBe(true);
					yield* TestClock.adjust(2000);
					yield* h.service.wake();
					yield* TestClock.adjust(2499);
					expect(h.recover).not.toHaveBeenCalled();
					yield* TestClock.adjust(1);
					expect(h.recover).toHaveBeenCalledTimes(2);
					expect(h.panels.slice(-2).every((p) => p.visible)).toBe(true);
				}),
			),
	);
	it.scoped(
		"MAIN-047 restores changed IDs by stable bounds and never moves to reused unrelated IDs",
		() =>
			withHarness((h) =>
				Effect.gen(function* () {
					yield* h.service.onStatus(connected, "a");
					yield* TestClock.adjust(1);
					yield* h.service.onStatus(connected, "b");
					yield* TestClock.adjust(1);
					yield* h.change([
						desktop,
						makeDisplay({ id: 2 }),
						{ ...a, id: 7 },
						b,
					]);
					expect(h.panels.filter((p) => p.serial === "a").at(-1)?.visible).toBe(
						false,
					);
					yield* TestClock.adjust(1500);
					expect(h.panels.filter((p) => p.serial === "a").at(-1)).toMatchObject(
						{
							id: 7,
							visible: true,
						},
					);
				}),
			),
	);
});
describe("connections at pairing completion", () => {
	it.scoped(
		"pairs a connection arriving after the session loop without repeating unchanged failures",
		() =>
			withHarness(
				(h) =>
					Effect.gen(function* () {
						yield* h.change([desktop, a]);
						yield* h.service.onStatus(connected, "a");
						yield* TestClock.adjust(1);
						const pairing = yield* h.service.redetect().pipe(Effect.forkScoped);
						yield* TestClock.adjust(1);
						expect(h.service.status().checking).toBe(true);
						yield* h.change([desktop, a, b]);
						yield* h.service.onStatus(connected, "b");
						yield* TestClock.adjust(1499);
						yield* Fiber.join(pairing);
						yield* TestClock.adjust(1);
						expect(
							h.service.status().orientations?.map((o) => o.serialNumber),
						).toEqual(["a", "b"]);
						expect(
							h.panels.filter((p) => p.serial === "b").at(-1),
						).toMatchObject({ id: b.id, visible: true });
						const calls = h.power.length;
						yield* TestClock.adjust(60000);
						expect(h.power).toHaveLength(calls);
					}),
				{
					prompts: {
						platform: "win32",
						mock: true,
						displays: () => [],
						primaryId: () => desktop.id,
						prompt: () => Effect.succeed(1),
						native: () => Effect.succeed("extended"),
						openSettings: () => Effect.void,
					},
				},
			),
	);
});

describe("Windows redetect deadlines", () => {
	for (const extendFails of [false, true])
		it.scoped(
			`clears a transient Windows probe failure only when retry has no native errors: extendFails=${extendFails}`,
			() => {
				let failed = true;
				const probe = () =>
					failed
						? Effect.fail(
								new DisplayOperationFailed(new Error("fake probe failed")),
							)
						: Effect.succeed({
								source: "wmi-name" as const,
								present: true,
								width: 1920,
								height: 480,
								failed: false,
							});
				return withHarness(
					(h) =>
						Effect.gen(function* () {
							yield* h.change([desktop, a]);
							yield* h.service.onStatus(connected, "a");
							yield* TestClock.adjust(1);
							const initial = yield* h.service
								.redetect()
								.pipe(Effect.forkScoped);
							yield* TestClock.adjust(1500);
							expect((yield* Fiber.join(initial)).issue).toBe("native-failed");
							failed = false;
							const retry = yield* h.service.redetect().pipe(Effect.forkScoped);
							yield* TestClock.adjust(1500);
							expect(yield* Fiber.join(retry)).toMatchObject({
								issue: extendFails ? "native-failed" : "none",
								usb: "pass",
								hdmi: "pass",
								native: { failed: false, present: true },
							});
						}),
					{
						prompts: {
							platform: "win32",
							mock: false,
							windowsExtend: () =>
								extendFails && !failed
									? Effect.fail(
											new DisplayOperationFailed(
												new Error("fake extend failure"),
											),
										)
									: Effect.void,
							windowsProbe: probe,
							displays: () => [],
							primaryId: () => desktop.id,
							prompt: () => Effect.succeed(0),
							native: () => Effect.succeed("extended"),
							openSettings: () => Effect.void,
						},
					},
				);
			},
		);

	for (const fails of [false, true])
		it.scoped(
			`MAIN-043 MAIN-059 keeps native ${fails ? "failure" : "WMI evidence"} and finishes at 6500ms`,
			() => {
				const probe = vi.fn(() =>
					fails
						? Effect.fail(
								new DisplayOperationFailed(new Error("token=private")),
							)
						: Effect.succeed({
								source: "wmi-name" as const,
								present: true,
								width: 0,
								height: 0,
								failed: false,
							}),
				);
				const extend = vi.fn(() => Effect.void);
				const prompt = vi.fn(() => Effect.succeed(0));
				return withHarness(
					(h) =>
						Effect.gen(function* () {
							yield* h.change([desktop]);
							const result = yield* h.service
								.redetect()
								.pipe(Effect.forkScoped);
							yield* TestClock.adjust(4999);
							expect(probe).not.toHaveBeenCalled();
							expect(h.service.status().checking).toBe(true);
							yield* TestClock.adjust(1);
							expect(probe).toHaveBeenCalledOnce();
							expect(h.service.status().native).toMatchObject({
								source: fails ? "none" : "wmi-name",
								failed: fails,
							});
							yield* TestClock.adjust(1499);
							expect(h.service.status().checking).toBe(true);
							yield* TestClock.adjust(1);
							const status = yield* Fiber.join(result);
							expect(status.checking).toBe(false);
							expect(status.hdmi).toBe("fail");
							expect(status.issue).toBe(fails ? "native-failed" : "none");
							expect(JSON.stringify(status)).not.toContain("private");
							expect(extend).toHaveBeenCalledOnce();
						}),
					{
						prompts: {
							platform: "win32",
							mock: false,
							windowsProbe: probe,
							windowsExtend: extend,
							displays: () => [],
							primaryId: () => 1,
							prompt,
							native: () => Effect.succeed("unavailable"),
							openSettings: () => Effect.void,
						},
					},
				);
			},
		);
});

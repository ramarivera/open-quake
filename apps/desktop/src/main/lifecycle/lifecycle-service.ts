import { Effect, Fiber, Option } from "effect";
import type { Display } from "electron";
import type { DeviceStatusEvent } from "../../preload/quake";
import type { ConnectionDiagnostic } from "../../shared/lifecycle-contracts";
import { findPanelDisplay, isPanelShaped, physicalSize } from "../display";
import { type DiscoveryEdges, makeDiscovery } from "./discovery";
import { makeDisplayPrompts, type PromptEdges } from "./prompts";

export interface LifecycleEdges extends DiscoveryEdges {
	readonly mock: boolean;
	readonly prompts: PromptEdges;
	readonly development: boolean;
	readonly panel: (
		display: Display | undefined,
		visible: boolean,
		fallback: boolean,
	) => void;
	readonly notify: (status: ConnectionDiagnostic) => void;
}

export class DeviceLifecycle extends Effect.Service<DeviceLifecycle>()(
	"Desktop/DeviceLifecycle",
	{
		accessors: true,
		scoped: (edges: LifecycleEdges) =>
			Effect.gen(function* () {
				const scope = yield* Effect.scope;
				const discovery = yield* makeDiscovery(edges);
				const prompts = yield* makeDisplayPrompts(edges.prompts);
				let connected = false;
				let locked = false;
				let grace = false;
				let bound = Option.none<Display>();
				let attempted = false;
				let checking = false;
				let issue: ConnectionDiagnostic["issue"] = "none";
				let loss = Option.none<Fiber.RuntimeFiber<void, never>>();
				let recovery = Option.none<Fiber.RuntimeFiber<void, never>>();
				let pairing =
					Option.none<Fiber.RuntimeFiber<ConnectionDiagnostic, never>>();
				const current = (): Display | undefined => {
					const binding = bound;
					if (Option.isSome(binding))
						return edges.displays().find((d) => d.id === binding.value.id);
					return attempted && !edges.mock
						? undefined
						: findPanelDisplay(edges.displays());
				};
				const status = (): ConnectionDiagnostic => {
					const identified = current();
					// An unpaired candidate can explain a resolution mismatch, but cannot
					// turn a failed pairing transaction into a passing HDMI check.
					const display = identified ?? findPanelDisplay(edges.displays());
					const size = display
						? physicalSize(display)
						: { width: 0, height: 0 };
					return {
						usb: connected ? "pass" : "fail",
						hdmi: identified && isPanelShaped(identified) ? "pass" : "fail",
						checking,
						mock: edges.mock,
						...size,
						resolutionMismatch: !!display && !isPanelShaped(display),
						issue,
					};
				};
				const sync = (): void => {
					const display = current();
					const fallback = !display && edges.development && !grace && !checking;
					edges.panel(
						display,
						!locked &&
							((!!display && isPanelShaped(display) && connected) || fallback),
						fallback,
					);
					edges.notify(status());
				};
				const redetect = Effect.fn("DeviceLifecycle.redetect")(function* (
					refresh = true,
				): Effect.fn.Return<ConnectionDiagnostic> {
					if (locked || checking) return status();
					checking = true;
					sync();
					const fiber = yield* Effect.gen(function* () {
						if (refresh) yield* edges.bus()?.recover?.() ?? Effect.void;
						if (!edges.mock && connected) {
							attempted = true;
							const result = yield* discovery.run();
							bound = result.display;
							issue = result.issue;
						}
						return status();
					}).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								checking = false;
								sync();
							}),
						),
						Effect.map(() => status()),
						Effect.forkIn(scope),
					);
					pairing = Option.some(fiber);
					return yield* Fiber.join(fiber);
				});
				const startPairing = redetect(false).pipe(
					Effect.forkIn(scope),
					Effect.asVoid,
				);
				const onStatus = Effect.fn("DeviceLifecycle.onStatus")(function* (
					event: DeviceStatusEvent,
				): Effect.fn.Return<void> {
					const wasConnected = connected;
					connected = event.state === "connected";
					if (connected) {
						if (Option.isSome(loss)) yield* Fiber.interrupt(loss.value);
						grace = false;
						sync();
						if (!wasConnected && !locked) yield* startPairing;
					} else {
						if (wasConnected) {
							grace = true;
							if (Option.isSome(pairing)) yield* Fiber.interrupt(pairing.value);
							loss = Option.some(
								yield* Effect.sleep(3000).pipe(
									Effect.zipRight(
										Effect.sync(() => {
											grace = false;
											sync();
										}),
									),
									Effect.forkIn(scope),
								),
							);
						}
						sync();
					}
				});
				const topology = Effect.fn("DeviceLifecycle.topology")(
					function* (): Effect.fn.Return<void> {
						if (locked) return;
						sync();
						if (!checking && connected && !current()) yield* startPairing;
					},
				);
				const lock = Effect.fn("DeviceLifecycle.lock")(
					function* (): Effect.fn.Return<void> {
						locked = true;
						if (Option.isSome(recovery)) yield* Fiber.interrupt(recovery.value);
						if (Option.isSome(pairing)) yield* Fiber.interrupt(pairing.value);
						sync();
					},
				);
				const wake = Effect.fn("DeviceLifecycle.wake")(function* (
					unlock = true,
				): Effect.fn.Return<void> {
					if (unlock) locked = false;
					if (locked) return;
					if (Option.isSome(recovery)) yield* Fiber.interrupt(recovery.value);
					recovery = Option.some(
						yield* Effect.sleep(2500).pipe(
							Effect.zipRight(
								Effect.gen(function* () {
									yield* edges.bus()?.recover?.(true) ?? Effect.void;
									yield* redetect(false);
								}),
							),
							Effect.forkIn(scope),
						),
					);
				});
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => edges.panel(undefined, false, false)),
				);
				yield* Effect.forever(
					Effect.sleep(1000).pipe(
						Effect.zipRight(
							Effect.suspend(() => prompts.check(current(), locked)),
						),
					),
				).pipe(Effect.forkScoped);
				return {
					status,
					redetect,
					onStatus,
					topology,
					lock,
					wake,
					repair: () => prompts.repair(current()),
					openSettings: edges.prompts.openSettings,
				};
			}),
	},
) {}

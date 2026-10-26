import { Effect, Fiber, Option } from "effect";
import type { Display } from "electron";
import type { DeviceStatusEvent } from "../../preload/quake";
import type {
	ConnectionDiagnostic,
	NativeDisplayEvidence,
} from "../../shared/lifecycle-contracts";
import type { DeviceBus } from "../deviceBus";
import {
	findPanelDisplay,
	isPanelCandidate,
	isPanelShaped,
	physicalLayout,
	physicalSize,
} from "../display";
import { type DiscoveryEdges, makeDiscovery } from "./discovery";
import { makeDisplayPrompts, type PromptEdges } from "./prompts";
import { planRecovery } from "./recovery-plan";

export interface LifecycleEdges extends DiscoveryEdges {
	readonly mock: boolean;
	readonly prompts: PromptEdges;
	readonly development: boolean;
	readonly disposePanel?: (serial?: string) => void;
	readonly activeCount?: (count: number) => Effect.Effect<void>;
	readonly busFor?: (serial: string) => DeviceBus | undefined;
	readonly panel: (
		display: Display | undefined,
		visible: boolean,
		fallback: boolean,
		serial?: string,
	) => void;
	readonly notify: (status: ConnectionDiagnostic) => void;
	readonly alert?: (
		serial: string,
		alert: NonNullable<ConnectionDiagnostic["alert"]>,
	) => void;
}
/** A grace lease belongs to this serial's observed display, not a recycled OS ID. */
const sameGraceDisplay = (saved: Display, live: Display): boolean =>
	saved.id === live.id &&
	saved.label.trim().toUpperCase() === live.label.trim().toUpperCase() &&
	saved.internal === live.internal &&
	saved.scaleFactor === live.scaleFactor &&
	saved.rotation === live.rotation &&
	saved.bounds.x === live.bounds.x &&
	saved.bounds.y === live.bounds.y &&
	saved.bounds.width === live.bounds.width &&
	saved.bounds.height === live.bounds.height &&
	saved.size.width === live.size.width &&
	saved.size.height === live.size.height;

interface Session {
	requireBlanking: boolean;
	connected: boolean;
	grace: boolean;
	closing: boolean;
	bound: Display | undefined;
	stable: Display | undefined;
	issue: ConnectionDiagnostic["issue"];
	loss: Fiber.RuntimeFiber<void, never> | undefined;
	generation: number;
}
export class DeviceLifecycle extends Effect.Service<DeviceLifecycle>()(
	"Desktop/DeviceLifecycle",
	{
		accessors: true,
		scoped: (edges: LifecycleEdges) =>
			Effect.gen(function* () {
				const scope = yield* Effect.scope;
				const prompts = yield* makeDisplayPrompts(edges.prompts);
				const sessions = new Map<string, Session>();
				let selected = "desktop-preview";
				let locked = false;
				let wizardOpen = false;
				let settling = false;
				let checking = false;
				let topologyPending = false;
				const pendingConnections = new Set<string>();
				let generation = 0;
				let topologyFiber: Fiber.RuntimeFiber<void, never> | undefined;
				let recovery: Fiber.RuntimeFiber<void, never> | undefined;
				let pairing: Fiber.RuntimeFiber<void, never> | undefined;
				let native: NativeDisplayEvidence | undefined;
				let modeCheck: Fiber.RuntimeFiber<void, never> | undefined;
				let modeCheckPending = false;
				let discovering = selected;
				const session = (serial = selected): Session => {
					let state = sessions.get(serial);
					if (!state) {
						state = {
							requireBlanking: false,
							connected: false,
							grace: false,
							closing: false,
							bound: undefined,
							stable: undefined,
							issue: "none",
							loss: undefined,
							generation: 0,
						};
						sessions.set(serial, state);
					}
					return state;
				};
				const current = (serial = selected): Display | undefined => {
					const binding = session(serial).bound;
					if (binding)
						return edges
							.displays()
							.find((d) => d.id === binding.id && isPanelCandidate(d));
					return edges.mock && sessions.size <= 1
						? findPanelDisplay(edges.displays())
						: undefined;
				};
				const discovery = yield* makeDiscovery({
					requireBlanking: () => session(discovering).requireBlanking,
					...edges,
					bus: () => edges.busFor?.(discovering) ?? edges.bus(),
					displays: () =>
						edges
							.displays()
							.filter(
								(d) =>
									![...sessions.entries()].some(
										([serial, state]) =>
											serial !== discovering &&
											state.connected &&
											state.bound?.id === d.id,
									),
							),
				});
				const candidateTopology = () =>
					JSON.stringify(physicalLayout(edges.displays()));
				const status = (): ConnectionDiagnostic => {
					const state = session();
					const identified = current();
					const display = identified ?? findPanelDisplay(edges.displays());
					const size = display
						? physicalSize(display)
						: { width: 0, height: 0 };
					const active = [...sessions.entries()].filter(([, s]) => s.connected);
					const unresolved = active.filter(([serial]) => !current(serial));
					return {
						usb: state.connected ? "pass" : "fail",
						hdmi:
							state.connected && identified && isPanelShaped(identified)
								? "pass"
								: "fail",
						checking,
						mock: edges.mock,
						...size,
						resolutionMismatch: !!display && !isPanelShaped(display),
						issue: state.issue,
						layout: physicalLayout(edges.displays()),
						...(native ? { native } : {}),
						orientations: active.flatMap(([serial, s]) => {
							const d = current(serial);
							if (!d) return [];
							const rotation = ((d.rotation % 360) + 360) % 360;
							const isVertical =
								d.size.width > 0 && d.size.height > 0
									? d.size.height > d.size.width
									: rotation === 90 || rotation === 270;
							return [
								{
									serialNumber: serial,
									rotation,
									isVertical,
									orientation: isVertical
										? ("vertical" as const)
										: ("horizontal" as const),
									connected: s.connected,
								},
							];
						}),
						...(unresolved.length &&
						edges.displays().filter(isPanelCandidate).length > 1
							? {
									alert: {
										alertType: "multi-screen" as const,
										deviceSNs: active.map(([serial]) => serial),
									},
								}
							: {}),
					};
				};
				const sync = () => {
					if (!sessions.size) session();
					for (const [serial, state] of sessions) {
						const display = current(serial);
						const fallback =
							serial === selected &&
							!display &&
							edges.development &&
							!state.grace &&
							!state.closing &&
							!checking &&
							!settling;
						edges.panel(
							display,
							!locked &&
								!settling &&
								((!!display && isPanelShaped(display) && state.connected) ||
									fallback),
							fallback,
							serial,
						);
					}
					const diagnostic = status();
					edges.notify(diagnostic);
					if (diagnostic.alert)
						for (const serial of diagnostic.alert.deviceSNs)
							edges.alert?.(serial, diagnostic.alert);
				};
				const activeCount = () =>
					edges.activeCount?.(
						[...sessions.values()].filter((s) => s.connected || s.grace).length,
					) ?? Effect.void;
				const repairFailed = Effect.sync(() => {
					session().issue = "native-failed";
					sync();
				});
				const repaired = (ok: boolean) =>
					Effect.sync(() => {
						if (ok && session().issue === "native-failed") {
							session().issue = "none";
							sync();
						}
					});
				const checkPrompts = () =>
					Effect.suspend(() =>
						prompts.check(current(), locked, wizardOpen),
					).pipe(
						Effect.tap(repaired),
						Effect.catchTag("DisplayOperationFailed", () => repairFailed),
					);
				const scheduleModeCheck = Effect.gen(function* () {
					if (modeCheck) yield* Fiber.interrupt(modeCheck);
					modeCheckPending = true;
					modeCheck = yield* Effect.sleep(1000).pipe(
						Effect.zipRight(
							Effect.sync(() => {
								modeCheckPending = false;
							}),
						),
						Effect.zipRight(checkPrompts()),
						Effect.asVoid,
						Effect.forkIn(scope),
					);
				});
				const recoverBindings = () => {
					const active = [...sessions.entries()].filter(([, s]) => s.connected);
					const plan = planRecovery(
						active.map(([serial, s]) => ({
							serial,
							displayId: s.bound?.id,
							bounds: s.stable?.bounds,
						})),
						edges.displays(),
					);
					for (const [serial, state] of active) {
						// Initial real pairing still requires label+size or blanking proof.
						if (!state.stable) continue;
						state.bound = plan.assigned.get(serial);
						if (state.bound) {
							state.stable = state.bound;
							state.requireBlanking = false;
						}
					}
				};
				const redetect = Effect.fn("DeviceLifecycle.redetect")(function* (
					refresh = true,
				): Effect.fn.Return<ConnectionDiagnostic> {
					if (locked || checking) return status();
					checking = true;
					const token = generation;
					let attemptedTopology = candidateTopology();
					const fiber = yield* Effect.gen(function* () {
						sync();
						if (refresh) {
							yield* edges.bus()?.recover?.() ?? Effect.void;
							if (!edges.mock && edges.prompts.platform === "win32") {
								let preparationFailed = false;
								yield* prompts.prepareWindows().pipe(
									Effect.catchTag("DisplayOperationFailed", () =>
										Effect.sync(() => {
											preparationFailed = true;
										}).pipe(Effect.zipRight(repairFailed), Effect.as(false)),
									),
								);
								for (
									let elapsed = 0;
									elapsed < 5000 && !edges.displays().some(isPanelCandidate);
									elapsed += 500
								)
									yield* Effect.sleep(500);
								if (edges.prompts.windowsProbe) {
									native = yield* edges.prompts.windowsProbe().pipe(
										Effect.catchTag("DisplayOperationFailed", () =>
											Effect.sync(() => {
												session().issue = "native-failed";
												return {
													source: "none" as const,
													present: false,
													width: 0,
													height: 0,
													failed: true,
												};
											}),
										),
									);
									if (!preparationFailed && !native.failed)
										yield* repaired(true);
								}
							}
						}
						if (!edges.mock) {
							for (const [serial, state] of sessions) {
								pendingConnections.delete(serial);
								if (!state.connected || locked || token !== generation)
									continue;
								if (current(serial) && state.stable && !refresh) continue;
								discovering = serial;
								const deviceToken = state.generation;
								while (true) {
									topologyPending = false;
									const before = candidateTopology();
									attemptedTopology = before;
									const result = yield* discovery.run();
									if (
										token !== generation ||
										deviceToken !== state.generation ||
										!state.connected ||
										locked
									)
										break;
									state.bound = Option.getOrUndefined(result.display);
									if (state.bound) {
										state.stable = state.bound;
										state.requireBlanking = false;
									}
									if (state.issue !== "native-failed")
										state.issue = result.issue;
									if (
										!topologyPending ||
										current(serial) ||
										before === candidateTopology() ||
										!edges.displays().some(isPanelCandidate)
									)
										break;
								}
							}
						}
						if (refresh && !edges.mock && edges.prompts.platform === "win32")
							yield* Effect.sleep(1500);
					}).pipe(
						Effect.ensuring(
							Effect.gen(function* () {
								checking = false;
								const pending =
									pendingConnections.size > 0 ||
									(topologyPending &&
										attemptedTopology !== candidateTopology());
								pendingConnections.clear();
								topologyPending = false;
								sync();
								if (
									pending &&
									!locked &&
									token === generation &&
									[...sessions.entries()].some(
										([serial, s]) => s.connected && !current(serial),
									)
								) {
									yield* startPairing();
								}
							}),
						),
						Effect.forkIn(scope),
					);
					pairing = fiber;
					return yield* Fiber.join(fiber).pipe(Effect.map(() => status()));
				});
				const startPairing = () =>
					redetect(false).pipe(Effect.forkIn(scope), Effect.asVoid);
				const onStatus = Effect.fn("DeviceLifecycle.onStatus")(function* (
					event: DeviceStatusEvent,
					serial = edges.bus()?.serial?.() ?? selected,
				): Effect.fn.Return<void> {
					if (
						serial !== "desktop-preview" &&
						sessions.get("desktop-preview")?.connected === false
					) {
						edges.panel(undefined, false, false, "desktop-preview");
						edges.disposePanel?.("desktop-preview");
						sessions.delete("desktop-preview");
					}
					selected = serial;
					const state = session(serial);
					const wasConnected = state.connected;
					state.connected = event.state === "connected";
					if (state.connected) {
						if (!wasConnected && state.bound) {
							const saved = state.bound;
							const live = edges
								.displays()
								.find((d) => sameGraceDisplay(saved, d) && isPanelCandidate(d));
							const claimed = [...sessions.entries()].some(
								([other, s]) =>
									other !== serial && s.connected && s.bound?.id === saved.id,
							);
							if (!live || claimed) {
								state.requireBlanking = true;
								state.bound = undefined;
								state.stable = undefined;
							}
						}
						if (state.loss) yield* Fiber.interrupt(state.loss);
						state.grace = false;
						state.closing = false;
						yield* activeCount();
						if (wasConnected || locked || edges.mock) sync();
						if (!wasConnected && !locked) {
							if (checking) {
								topologyPending = true;
								pendingConnections.add(serial);
							} else yield* startPairing();
						}
					} else {
						if (wasConnected) {
							state.generation++;
							state.grace = true;
							state.closing = true;
							if (pairing && discovering === serial)
								yield* Fiber.interrupt(pairing);
							state.loss = yield* Effect.gen(function* () {
								yield* Effect.sleep(3000);
								state.grace = false;
								state.bound = undefined;
								yield* activeCount();
								sync();
								yield* Effect.sleep(2000);
								if (!state.connected) {
									edges.disposePanel?.(serial);
									if (selected === serial)
										selected =
											[...sessions.entries()].find(
												([, s]) => s.connected,
											)?.[0] ?? serial;
									state.closing = false;
									sync();
								}
							}).pipe(Effect.forkIn(scope));
						}
						sync();
					}
				});
				const topology = Effect.fn("DeviceLifecycle.topology")(function* (
					metrics?: readonly string[],
				): Effect.fn.Return<void> {
					if (metrics?.length && metrics.every((m) => m === "workArea")) return;
					if (locked) {
						topologyPending = true;
						return;
					}
					if (checking) {
						topologyPending = true;
						return;
					}
					yield* scheduleModeCheck;
					// Park absent targets synchronously. All reassignment waits for the burst to settle.
					sync();
					if (topologyFiber) yield* Fiber.interrupt(topologyFiber);
					const token = generation;
					topologyFiber = yield* Effect.sleep(1500).pipe(
						Effect.zipRight(
							Effect.gen(function* () {
								if (locked || token !== generation) return;
								recoverBindings();
								sync();
								for (const [serial, state] of sessions)
									if (state.connected && !current(serial) && state.stable)
										edges.disposePanel?.(serial);
								if (
									[...sessions.entries()].some(
										([serial, s]) => s.connected && !current(serial),
									)
								)
									yield* startPairing();
							}),
						),
						Effect.forkIn(scope),
					);
				});
				const lock = Effect.fn("DeviceLifecycle.lock")(
					function* (): Effect.fn.Return<void> {
						locked = true;
						modeCheckPending = false;
						if (modeCheck) yield* Fiber.interrupt(modeCheck);
						settling = false;
						generation++;
						if (recovery) yield* Fiber.interrupt(recovery);
						if (topologyFiber) yield* Fiber.interrupt(topologyFiber);
						if (pairing) yield* Fiber.interrupt(pairing);
						sync();
					},
				);
				const wake = Effect.fn("DeviceLifecycle.wake")(function* (
					unlock = true,
				): Effect.fn.Return<void> {
					if (unlock) locked = false;
					if (locked) return;
					generation++;
					const token = generation;
					settling = true;
					sync();
					if (recovery) yield* Fiber.interrupt(recovery);
					if (topologyFiber) yield* Fiber.interrupt(topologyFiber);
					if (modeCheck) yield* Fiber.interrupt(modeCheck);
					modeCheckPending = false;
					if (pairing) yield* Fiber.interrupt(pairing);
					recovery = yield* Effect.sleep(2500).pipe(
						Effect.zipRight(
							Effect.gen(function* () {
								if (locked || token !== generation) return;
								for (const serial of sessions.keys())
									yield* (edges.busFor?.(serial) ?? edges.bus())?.recover?.(
										true,
									) ?? Effect.void;
								if (locked || token !== generation) return;
								settling = false;
								recoverBindings();
								yield* redetect(false);
							}),
						),
						Effect.forkIn(scope),
					);
				});
				yield* Effect.addFinalizer(() =>
					Effect.gen(function* () {
						generation++;
						for (const serial of sessions.keys()) {
							edges.panel(undefined, false, false, serial);
							edges.disposePanel?.(serial);
						}
						yield* edges.activeCount?.(0) ?? Effect.void;
					}),
				);
				yield* Effect.forever(
					Effect.sleep(1000).pipe(
						Effect.zipRight(
							Effect.suspend(() =>
								modeCheckPending ? Effect.void : checkPrompts(),
							),
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
					wizard: (open: boolean) =>
						Effect.sync(() => {
							wizardOpen = open;
						}),
					repair: () =>
						prompts.repair(current()).pipe(
							Effect.tap(repaired),
							Effect.tapError(() => repairFailed),
							Effect.asVoid,
						),
					openSettings: edges.prompts.openSettings,
				};
			}),
	},
) {}

import {
	Clock,
	Context,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Schema,
} from "effect";
import { pageIndex } from "../profiles/key-editing-invariants.js";
import {
	type ProfileEnvelope,
	ProfileKey,
} from "../profiles/profile-contracts.js";
import { isUnsupportedProfileKey } from "../profiles/profile-function-contracts.js";
import {
	FolderConfig,
	GoToPageConfig,
	HotkeySwitchConfig,
	MultiActionConfig,
	NextPageConfig,
	normalizeSequenceWebsites,
	normalizeWebsiteUrl,
	PreviousPageConfig,
	type SequenceAudioConfig,
	SwitchProfileConfig,
	TimerConfig,
} from "./action-contracts.js";
import {
	type ActionError,
	HostActionFailed,
	InvalidKeyAction,
	KeyFunctionUnavailable,
} from "./action-errors.js";
import { validateAction } from "./action-invariants.js";
import { type ActionConfig, retainedActionOwner } from "./action-registry.js";
import { KeyDisplayEvent, KeyPanelMessage } from "./key-display-contracts.js";
import { isObsId } from "./obs-contracts.js";
export interface KeyFeedback {
	readonly deviceId: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly keyCode: string;
	readonly revision?: number;
	readonly icon?: string;
	readonly countdownPhase?: "running" | "expired" | "hidden";
	readonly endAt?: number;
	readonly timerCompleted?: boolean;
	readonly alternate?: 0 | 1;
	readonly volume?: number;
	readonly muted?: boolean;
	readonly countdown?: number;
	readonly progress?: number;
	readonly alert?: 0 | 1 | 2 | 3;
}
export interface KeyActivation {
	readonly deviceId: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly revision: number;
}
/** Awaitable plugin boundary. The plugins lane owns runtime registration. */
export interface PluginActionPort {
	readonly execute: (
		step: typeof import("./action-contracts.js").PluginSequenceStep.Type,
		activation: KeyActivation & {
			readonly keyCode: string;
			readonly stepIndex: number;
		},
	) => Effect.Effect<void, ActionError>;
}
export class KeyRuntimePort extends Context.Tag(
	"@open-quake/device/KeyRuntimePort",
)<
	KeyRuntimePort,
	{
		readonly read: Effect.Effect<ProfileEnvelope, ActionError>;
		readonly execute: (
			config: ActionConfig,
			deviceId?: string,
		) => Effect.Effect<void, ActionError>;
		/** Side-effect-free validation supplied by the soundboard owner. */
		readonly validateSequenceAudio?: (
			config: typeof SequenceAudioConfig.Type,
		) => Effect.Effect<void, ActionError>;
		/** Host integrations receive only the committed key after activation guards. */
		readonly executeOwned?: (
			key: ProfileKey,
			activation: KeyActivation,
		) => Effect.Effect<boolean, ActionError>;
		/** The plugins lane supplies the real executor. Interruption cancels awaited work. */
		readonly executePlugin?: PluginActionPort["execute"];
		readonly timerCompleted?: (
			activation: KeyActivation & { readonly keyCode: string },
		) => Effect.Effect<void, ActionError>;
		readonly resetOwned?: (deviceId?: string) => Effect.Effect<void>;
		/** Acquires a held chord and returns release bound to that keyboard session. */
		readonly holdHotkey?: (
			key: ProfileKey,
			activation: KeyActivation,
		) => Effect.Effect<Effect.Effect<void, ActionError>, ActionError>;
		readonly publish: (state: KeyFeedback) => Effect.Effect<void>;
		readonly select: (
			deviceId: string,
			profileId: string,
			pageId: string,
		) => Effect.Effect<void, ActionError>;
		readonly alarm: (
			deviceId: string,
			sound: string,
		) => Effect.Effect<void, ActionError>;
	}
>() {}
export const unavailablePluginAction: PluginActionPort["execute"] = () =>
	Effect.fail(new KeyFunctionUnavailable("plugin-runtime"));
const unavailable = Effect.fail(new KeyFunctionUnavailable("owning-runtime"));
const NoPort = Layer.succeed(KeyRuntimePort, {
	read: unavailable,
	execute: () => unavailable,
	publish: () => Effect.void,
	select: () => unavailable,
	alarm: () => unavailable,
});

export class KeyRuntime extends Effect.Service<KeyRuntime>()(
	"@open-quake/device/KeyRuntime",
	{
		accessors: true,
		dependencies: [NoPort],
		scoped: Effect.gen(function* () {
			const port = yield* KeyRuntimePort,
				scope = yield* Effect.scope;
			const states = new Map<string, KeyFeedback>();
			const alertVersions = new Map<string, object>();
			const progressVersions = new Map<string, object>();
			const clearedAt = new Map<
				string,
				{ readonly revision: number; readonly time: number }
			>();
			const timerTaps = new Map<
				string,
				{ readonly revision: number; readonly time: number }
			>();
			const displayTimers = new Map<string, Fiber.RuntimeFiber<void, never>>();
			const returnContexts = new Map<string, KeyActivation[]>();
			const stateId = (state: KeyFeedback): string =>
				JSON.stringify([
					state.deviceId,
					state.profileId,
					state.pageId,
					state.keyCode,
				]);
			const audioPresses = new Map<string, KeyActivation>();
			const contacts = new Map<
				string,
				{
					key: ProfileKey;
					activation: KeyActivation;
					release?: Effect.Effect<void, ActionError>;
				}
			>();
			const held = new Set<string>(),
				alternates = new Map<string, 0 | 1>(),
				running = new Map<
					string,
					{
						readonly revision: number;
						readonly fiber: Fiber.RuntimeFiber<void, never>;
					}
				>();
			const lock = yield* Effect.makeSemaphore(1);
			const owned = new Map<Fiber.RuntimeFiber<void, ActionError>, string>();
			const ownedControls = new Set<string>();
			const current = (env: ProfileEnvelope, deviceId: string) => {
				const selection = env.activeByDevice[deviceId];
				const hidden = Option.isSome(env.manager)
					? env.manager.value.hidden
					: [];
				const visible = env.profiles.filter((p) => !hidden.includes(p.id));
				const profile =
					visible.find((p) => p.id === selection?.profileId) ??
					visible[0] ??
					env.profiles[0];
				const page =
					profile.pages.find((p) => p.id === selection?.pageId) ??
					profile.pages[0];
				return { profile, page };
			};
			const feedback = Effect.fn("KeyRuntime.feedback")(function* (
				state: KeyFeedback,
			): Effect.fn.Return<void> {
				const active = yield* port.read.pipe(Effect.option);
				if (Option.isSome(active)) {
					const { profile, page } = current(active.value, state.deviceId);
					const visible =
						profile.id === state.profileId && page.id === state.pageId;
					const owner = active.value.profiles.find(
						(p) => p.id === state.profileId,
					);
					if (
						!owner ||
						(state.revision !== undefined && owner.revision !== state.revision)
					)
						return;
					const previous = states.get(stateId(state));
					const value = {
						...(previous?.revision === state.revision ? previous : undefined),
						...state,
						...(!visible ? { alert: 0 as const } : {}),
					};
					states.set(stateId(state), value);
					if (visible) yield* port.publish(value);
					const id = stateId(state);
					const target = {
						deviceId: state.deviceId,
						profileId: state.profileId,
						pageId: state.pageId,
						keyCode: state.keyCode,
						...(state.revision === undefined
							? {}
							: { revision: state.revision }),
					};
					if (state.alert !== undefined) {
						const version = {};
						alertVersions.set(id, version);
						if (state.alert === 1)
							yield* Effect.forkIn(
								Effect.sleep(2000).pipe(
									Effect.zipRight(
										Effect.suspend(() =>
											alertVersions.get(id) === version
												? feedback({ ...target, alert: 0 })
												: Effect.void,
										),
									),
								),
								scope,
							);
					}
					if (
						state.progress !== undefined &&
						(state.revision !== previous?.revision ||
							state.progress !== previous?.progress)
					) {
						const version = {};
						progressVersions.set(id, version);
						if (state.progress >= 0)
							yield* Effect.forkIn(
								Effect.sleep(state.progress >= 100 ? 1000 : 5000).pipe(
									Effect.zipRight(
										Effect.suspend(() =>
											progressVersions.get(id) === version
												? feedback({ ...target, progress: -1 })
												: Effect.void,
										),
									),
								),
								scope,
							);
					}
				}
			});
			const refresh = Effect.fn("KeyRuntime.refresh")(function* (
				deviceId: string,
			): Effect.fn.Return<void, ActionError> {
				const env = yield* port.read;
				const { profile, page } = current(env, deviceId);
				for (const value of states.values())
					if (
						value.deviceId === deviceId &&
						value.profileId === profile.id &&
						value.pageId === page.id &&
						(value.revision === undefined ||
							value.revision === profile.revision)
					)
						yield* port.publish(value);
			});

			const navigate = Effect.fn("KeyRuntime.navigate")(function* (
				deviceId: string,
				direction: 0 | 1 | 2 | 3,
				pageNumber?: number,
			): Effect.fn.Return<void, ActionError> {
				const env = yield* port.read;
				const { profile, page } = current(env, deviceId);
				if (direction < 2) {
					const at = profile.pages.findIndex((p) => p.id === page.id);
					const next =
						profile.pages[
							pageNumber === undefined
								? pageIndex(at, profile.pages.length, direction === 0 ? -1 : 1)
								: Math.min(
										profile.pages.length - 1,
										Math.max(0, pageNumber - 1),
									)
						];
					if (next) {
						yield* port.select(deviceId, profile.id, next.id);
						yield* refresh(deviceId);
					}
					return;
				}
				const hidden = Option.isSome(env.manager)
					? env.manager.value.hidden
					: [];
				const visible = env.profiles
					.filter(
						(p) =>
							!hidden.includes(p.id) &&
							p.pages.some((page) =>
								page.keys.some(
									(key) => key.config.display && key.config.type !== "",
								),
							),
					)
					.sort((a, b) =>
						a.name.localeCompare(b.name, undefined, { numeric: true }),
					);
				const next =
					visible[
						pageIndex(
							visible.findIndex((p) => p.id === profile.id),
							visible.length,
							direction === 2 ? -1 : 1,
						)
					];
				if (next) {
					yield* port.select(deviceId, next.id, next.pages[0].id);
					yield* refresh(deviceId);
				}
			});
			const activate = Effect.fn("KeyRuntime.activate")(function* (
				deviceId: string,
				keyCode: string,
				kind: "press" | "release" | "down" | "up" | "cancel",
				expected?: {
					readonly profileId: string;
					readonly pageId: string;
					readonly revision: number;
				},
			): Effect.fn.Return<
				Effect.Effect<void, ActionError> | undefined,
				ActionError
			> {
				const control = JSON.stringify([deviceId, keyCode]);
				if (kind === "up" || kind === "cancel") {
					if (kind === "cancel") {
						for (const [identity, entry] of running) {
							const parts: unknown = JSON.parse(identity);
							if (
								Array.isArray(parts) &&
								parts[0] === deviceId &&
								parts[3] === keyCode
							) {
								running.delete(identity);
								yield* Fiber.interrupt(entry.fiber);
							}
						}
					}
					const contact = contacts.get(control);
					if (!contact) return;
					if (contact.release) {
						yield* contact.release;
						contacts.delete(control);
						return;
					}
					contacts.delete(control);
					if (
						kind === "cancel" ||
						["vol", "luminance", "brightness", "directionalHotkey"].includes(
							contact.key.config.type,
						)
					)
						return;
					const pressed = yield* Effect.either(
						activate(deviceId, keyCode, "press", contact.activation),
					);
					const releaseWork = yield* activate(
						deviceId,
						keyCode,
						"release",
						contact.activation,
					);
					if (Either.isLeft(pressed)) return yield* Effect.fail(pressed.left);
					return releaseWork ?? pressed.right;
				}
				if (kind === "down" && contacts.has(control)) return;
				if (kind === "release") {
					if (!held.delete(control)) return;
				} else if (kind === "press") {
					if (held.has(control)) return;
					held.add(control);
				}
				const env = yield* port.read;
				const { profile, page } = current(env, deviceId);
				if (
					expected &&
					(expected.profileId !== profile.id ||
						expected.pageId !== page.id ||
						expected.revision !== profile.revision)
				)
					return;
				const key = page.keys.find(
					(k) => k.keyCode === keyCode && k.config.display,
				);
				if (!key || isUnsupportedProfileKey(key)) return;
				if (kind === "down") {
					if (key.config.type === "hotkey" && key.config.supportKnob) return;
					const activation = {
						deviceId,
						profileId: profile.id,
						pageId: page.id,
						revision: profile.revision,
					};
					if (key.config.type === "hotkey") {
						if (!port.holdHotkey)
							return yield* Effect.fail(
								new KeyFunctionUnavailable("adapter-missing"),
							);
						const release = yield* port.holdHotkey(key, activation);
						contacts.set(control, { key, activation, release });
					} else contacts.set(control, { key, activation });
					return;
				}
				const identity = JSON.stringify([
					deviceId,
					profile.id,
					page.id,
					keyCode,
				]);
				const base = {
					deviceId,
					profileId: profile.id,
					pageId: page.id,
					keyCode,
					revision: profile.revision,
				};
				const input = Schema.encodeSync(ProfileKey)(key).config;
				const type = key.config.type;
				const localAudio =
					type === "playAudio" ||
					type === "playAudioLegacy" ||
					type === "stopAudio" ||
					type === "audioBot";
				if (localAudio) {
					if (kind === "press") {
						audioPresses.set(control, { ...base, revision: profile.revision });
						return;
					}
					const pressed = audioPresses.get(control);
					audioPresses.delete(control);
					if (
						!pressed ||
						pressed.profileId !== profile.id ||
						pressed.pageId !== page.id ||
						pressed.revision !== profile.revision
					)
						return;
				} else if (kind === "release") {
					audioPresses.delete(control);
					return;
				}
				if (
					[
						"folder",
						"createFolder",
						"back",
						"emojiFolder",
						"emojiBack",
					].includes(type)
				) {
					const decoded = Schema.decodeUnknownEither(FolderConfig)(input);
					if (decoded._tag === "Left")
						return yield* new InvalidKeyAction("config.actions", decoded.left);
					const stack = returnContexts.get(deviceId) ?? [];
					const last = stack.at(-1);
					const ref = decoded.right.actions[0]?.value;
					const back = type === "back" || type === "emojiBack";
					const destination =
						back && last
							? { profileId: last.profileId, pageId: last.pageId }
							: { profileId: profile.id, pageId: ref };
					const targetProfile = env.profiles.find(
						(p) => p.id === destination.profileId,
					);
					const targetPage = targetProfile?.pages.find(
						(p) => p.id === destination.pageId,
					);
					if (
						!targetProfile ||
						!targetPage ||
						(back && last && targetProfile.revision !== last.revision)
					)
						return yield* new InvalidKeyAction("config.actions");
					yield* port.select(deviceId, targetProfile.id, targetPage.id);
					returnContexts.set(
						deviceId,
						back ? stack.slice(0, -1) : [...stack, { ...base }],
					);
					yield* refresh(deviceId);
					return;
				}
				if (type === "switchProfile") {
					const decoded =
						Schema.decodeUnknownEither(SwitchProfileConfig)(input);
					if (decoded._tag === "Left")
						return yield* new InvalidKeyAction("config.actions", decoded.left);
					const ref = decoded.right.actions[0].value;
					if (ref === "-1" || ref === "-2") {
						const visible = env.profiles.filter(
							(p) =>
								!(Option.getOrUndefined(env.manager)?.hidden ?? []).includes(
									p.id,
								),
						);
						const next =
							visible[
								pageIndex(
									visible.findIndex((p) => p.id === profile.id),
									visible.length,
									ref === "-1" ? 1 : -1,
								)
							];
						if (next) {
							yield* port.select(deviceId, next.id, next.pages[0].id);
							yield* refresh(deviceId);
						}
						return;
					}
					const startup =
						Option.isSome(env.manager) &&
						Option.isSome(env.manager.value.startup)
							? env.manager.value.startup.value
							: undefined;
					const targetProfile = env.profiles.find(
						(p) =>
							p.id === (ref === "0" ? (startup ?? env.profiles[0]?.id) : ref),
					);
					const targetPage =
						targetProfile?.pages[decoded.right.actions[1].value - 1];
					if (
						!targetProfile ||
						!targetPage ||
						(Option.isSome(env.manager) &&
							env.manager.value.hidden.includes(targetProfile.id))
					)
						return yield* new InvalidKeyAction("config.actions");
					yield* port.select(deviceId, targetProfile.id, targetPage.id);
					yield* refresh(deviceId);
					return;
				}
				if (retainedActionOwner(type) === "display") return;

				if (type === "hotkeySwitch") {
					const decoded = Schema.decodeUnknownEither(HotkeySwitchConfig)(input);
					if (decoded._tag === "Left")
						return yield* Effect.fail(
							new InvalidKeyAction("config.actions", decoded.left),
						);
					const state = alternates.get(identity) ?? 0;
					yield* port.execute(
						{
							type: "hotkey",
							actions: [decoded.right.actions[state]],
						},
						deviceId,
					);
					alternates.set(identity, state === 0 ? 1 : 0);
					yield* feedback({ ...base, alternate: state === 0 ? 1 : 0 });
					return;
				}
				if (
					[
						"previousPage",
						"pageUp",
						"nextPage",
						"pageDown",
						"goToPage",
					].includes(type)
				) {
					const canonical =
						type === "pageUp"
							? "previousPage"
							: type === "pageDown"
								? "nextPage"
								: type;
					const validated = Schema.decodeUnknownEither(
						Schema.Union(GoToPageConfig, NextPageConfig, PreviousPageConfig),
					)({
						...input,
						type: canonical,
					});
					if (validated._tag === "Left")
						return yield* Effect.fail(
							new InvalidKeyAction("config.actions", validated.left),
						);
					const number =
						validated.right.type === "goToPage"
							? validated.right.actions[0].value
							: undefined;
					yield* navigate(
						deviceId,
						canonical === "previousPage" ? 0 : 1,
						canonical === "goToPage" && typeof number === "number"
							? number
							: undefined,
					);
					return;
				}
				if (type === "timer" || type === "multiActions") {
					const obsolete = running.get(identity);
					if (obsolete && obsolete.revision !== profile.revision) {
						running.delete(identity);
						timerTaps.delete(identity);
						yield* Fiber.interrupt(obsolete.fiber);
					}
					if (type === "timer") {
						const now = yield* Clock.currentTimeMillis;
						const state = states.get(identity);
						if (
							state?.countdownPhase === "expired" &&
							state.revision === profile.revision
						) {
							const expired = running.get(identity);
							if (expired) {
								running.delete(identity);
								yield* Fiber.interrupt(expired.fiber);
							}
							clearedAt.set(identity, {
								revision: profile.revision,
								time: now,
							});
							timerTaps.set(identity, {
								revision: profile.revision,
								time: now,
							});
							yield* feedback({
								...base,
								countdown: -1,
								countdownPhase: "hidden",
								alert: 0,
								timerCompleted: false,
							});
							return;
						}
						const previousTap = timerTaps.get(identity);
						if (
							previousTap?.revision === profile.revision &&
							now - previousTap.time < 600
						)
							return;
						timerTaps.set(identity, { revision: profile.revision, time: now });
					}
					const previous = running.get(identity);
					if (previous) {
						running.delete(identity);
						yield* Fiber.interrupt(previous.fiber);
						yield* feedback({
							...base,
							countdown: -1,
							countdownPhase: "hidden",
							progress: 100,
							alert: 0,
						});
						return;
					}
					let work: Effect.Effect<void, ActionError>;
					if (type === "timer") {
						const decoded = Schema.decodeUnknownEither(TimerConfig)(input);
						if (decoded._tag === "Left")
							return yield* Effect.fail(
								new InvalidKeyAction("config.actions", decoded.left),
							);
						const duration = decoded.right.actions.find(
							(a) => a.type === "time",
						)?.value;
						const sound = decoded.right.actions.find(
							(a) => a.type === "sound",
						)?.value;
						if (typeof duration !== "number")
							return yield* Effect.fail(new InvalidKeyAction("config.actions"));
						// Join the display writer before the native timer takes ownership.
						const displayTimer = displayTimers.get(identity);
						if (displayTimer) {
							yield* Fiber.interrupt(displayTimer);
							displayTimers.delete(identity);
						}
						work = Effect.gen(function* () {
							const end = (yield* Clock.currentTimeMillis) + duration;
							yield* feedback({
								...base,
								countdown: duration,
								endAt: end,
								countdownPhase: "running",
								timerCompleted: false,
								alert: 0,
							});
							let remaining = duration;
							while (remaining > 0) {
								yield* Effect.sleep(Math.min(1000, remaining));
								remaining = Math.max(0, end - (yield* Clock.currentTimeMillis));
								if (remaining > 0)
									yield* feedback({ ...base, countdown: remaining });
							}
							yield* feedback({
								...base,
								countdown: -1,
								countdownPhase: "expired",
								alert: 2,
							});
							const latest = yield* port.read;
							const selected = latest.activeByDevice[deviceId];
							const owner = latest.profiles.find((p) => p.id === profile.id);
							if (
								selected?.profileId !== profile.id ||
								selected.pageId !== page.id ||
								owner?.revision !== profile.revision
							)
								return;
							if (
								decoded.right.actions.some(
									(a) => a.type === "callback" && a.value === 1,
								)
							) {
								if (port.timerCompleted) yield* port.timerCompleted(base);
								yield* feedback({ ...base, timerCompleted: true });
							}
							if (typeof sound === "string" && sound)
								yield* port.alarm(deviceId, sound);
						});
					} else {
						const decoded = Schema.decodeUnknownEither(MultiActionConfig)(
							normalizeSequenceWebsites(input, key.config.title.text),
						);
						if (decoded._tag === "Left")
							return yield* Effect.fail(
								new InvalidKeyAction("config.actions", decoded.left),
							);
						// Validate the entire sequence before the first host effect.
						for (const step of decoded.right.subActions) {
							if (step.isPlugin === true || step.config.type === "delay")
								continue;
							if (
								step.config.type === "playAudioLegacy" ||
								step.config.type === "stopAudio"
							) {
								if (!port.validateSequenceAudio)
									return yield* new KeyFunctionUnavailable("owning-runtime");
								yield* port.validateSequenceAudio(step.config);
							} else if (
								validateAction(step.config.type, step.config)._tag === "Left"
							)
								return yield* Effect.fail(
									new InvalidKeyAction("config.actions"),
								);
						}
						work = Effect.gen(function* () {
							const steps = decoded.right.subActions;
							yield* feedback({ ...base, progress: 0, alert: 0 });
							for (let i = 0; i < steps.length; i++) {
								const step = steps[i];
								const config = step?.config;
								if (!config || !step) continue;
								if (step.isPlugin === true) {
									yield* (port.executePlugin ?? unavailablePluginAction)(step, {
										...base,
										stepIndex: i,
									});
								} else if (config.type === "delay")
									yield* Effect.sleep(
										typeof config.actions[0]?.value === "number"
											? config.actions[0].value
											: 0,
									);
								else if (
									config.type === "playAudioLegacy" ||
									config.type === "stopAudio" ||
									config.type === "cmd"
								) {
									if (!port.executeOwned)
										return yield* new KeyFunctionUnavailable("owning-runtime");
									const nested = Schema.decodeUnknownSync(ProfileKey)({
										...Schema.encodeSync(ProfileKey)(key),
										childrenName: config.type,
										config: { ...input, ...config },
									});
									if (!(yield* port.executeOwned(nested, { ...base })))
										return yield* new KeyFunctionUnavailable("owning-runtime");
								} else {
									const action = validateAction(config.type, config);
									if (action._tag === "Left")
										return yield* Effect.fail(action.left);
									if (action.right.type === "homeAssistant") {
										if (!port.executeOwned)
											return yield* new HostActionFailed(
												"home-assistant-unavailable",
											);
										const synthetic = {
											...key,
											config: {
												...key.config,
												type: action.right.type,
												actions: action.right.actions,
											},
										};
										if (
											!(yield* port.executeOwned(synthetic, {
												deviceId,
												profileId: profile.id,
												pageId: page.id,
												revision: profile.revision,
											}))
										)
											return yield* new HostActionFailed(
												"home-assistant-unavailable",
											);
									} else yield* port.execute(action.right, deviceId);
								}
								yield* feedback({
									...base,
									progress: Math.floor(((i + 1) / steps.length) * 100),
								});
								if (i < steps.length - 1)
									yield* Effect.sleep(config.gap ?? 100);
							}
						});
					}
					const fiber = yield* Effect.forkIn(
						Effect.yieldNow()
							.pipe(Effect.zipRight(work))
							.pipe(
								Effect.catchTags({
									InvalidKeyAction: () =>
										feedback({ ...base, alert: 1, progress: 100 }),
									KeyFunctionUnavailable: () =>
										feedback({ ...base, alert: 1, progress: 100 }),
									HostActionFailed: () =>
										feedback({ ...base, alert: 1, progress: 100 }),
									ActionPermissionDenied: () =>
										feedback({ ...base, alert: 1, progress: 100 }),
									ActionApplicationMissing: () =>
										feedback({ ...base, alert: 1, progress: 100 }),
									ActionSnapshotFailed: () =>
										feedback({ ...base, alert: 1, progress: 100 }),
								}),
								Effect.ensuring(Effect.sync(() => running.delete(identity))),
							),
						scope,
					);
					running.set(identity, { revision: profile.revision, fiber });
					return;
				}
				if (
					(type === "homeAssistant" ||
						localAudio ||
						isObsId(type) ||
						type === "cmd") &&
					port.executeOwned
				) {
					if (ownedControls.has(control)) return;
					if (isObsId(type) || type === "audioBot") {
						const validated = validateAction(
							Option.getOrElse(key.childrenName, () => type),
							input,
						);
						if (validated._tag === "Left")
							return yield* Effect.fail(validated.left);
					}
					// Reserve the committed press atomically, then await network work
					// outside the input lock. Reset owns the scoped fiber's lifetime.
					const execute = port.executeOwned;
					let fiber: Fiber.RuntimeFiber<void, ActionError>;
					fiber = yield* Effect.forkIn(
						Effect.yieldNow().pipe(
							Effect.zipRight(
								execute(key, { ...base, revision: profile.revision }),
							),
							Effect.flatMap((handled) =>
								handled
									? Effect.void
									: Effect.fail(new KeyFunctionUnavailable("owning-runtime")),
							),
							Effect.ensuring(
								Effect.sync(() => {
									owned.delete(fiber);
									ownedControls.delete(control);
								}),
							),
						),
						scope,
					);
					owned.set(fiber, deviceId);
					ownedControls.add(control);
					return Fiber.join(fiber);
				}
				if (type === "website") {
					const url = (input.actions ?? []).find(
						(a) => a.type === "url",
					)?.value;
					const normalized =
						typeof url === "string"
							? normalizeWebsiteUrl(url, key.config.title.text)
							: undefined;
					if (!normalized) return yield* new InvalidKeyAction("config.actions");
					yield* port.execute({
						type: "website",
						actions: [{ type: "url", value: normalized }],
					});
					return;
				}
				const action = validateAction(
					Option.getOrElse(key.childrenName, () => type),
					input,
				);
				if (action._tag === "Left") return yield* Effect.fail(action.left);
				yield* port.execute(action.right, deviceId);
			});
			const displayEvent = Effect.fn("KeyRuntime.displayEvent")(function* (
				input: unknown,
			): Effect.fn.Return<void, ActionError> {
				const decoded = Schema.decodeUnknownEither(KeyDisplayEvent)(input);
				if (decoded._tag === "Left")
					return yield* new InvalidKeyAction("activation", decoded.left);
				const event = decoded.right;
				const env = yield* port.read;
				if (!env.activeByDevice[event.deviceId]) return;
				const { profile, page } = current(env, event.deviceId);
				const key = page.keys.find(
					(k) => k.keyCode === event.keyCode && k.config.display,
				);
				if (
					!key ||
					isUnsupportedProfileKey(key) ||
					profile.id !== event.profileId ||
					page.id !== event.pageId ||
					profile.revision !== event.revision
				)
					return;
				const id = stateId(event);
				switch (event.type) {
					case "showAnimation":
						yield* feedback({ ...event, icon: event.resourceId });
						break;
					case "showAlert":
						yield* feedback({ ...event, alert: event.alertType });
						break;
					case "progress":
						yield* feedback({ ...event, progress: event.percent });
						break;
					case "countdown": {
						if (key.config.type !== "timer") return;
						const now = yield* Clock.currentTimeMillis;
						const retained = states.get(id);
						const previous =
							retained?.revision === event.revision ? retained : undefined;
						const clear = clearedAt.get(id);
						if (
							event.time > 0 &&
							clear?.revision === event.revision &&
							now - clear.time < 120
						)
							return;
						const owner = running.get(id);
						if (owner && owner.revision !== event.revision) {
							running.delete(id);
							yield* Fiber.interrupt(owner.fiber);
						}
						if (event.time > 0 && previous?.countdownPhase === "expired") {
							clearedAt.set(id, { revision: event.revision, time: now });
							const pending = displayTimers.get(id);
							if (pending) {
								yield* Fiber.interrupt(pending);
								displayTimers.delete(id);
							}
							yield* feedback({
								...event,
								countdown: -1,
								countdownPhase: "hidden",
								alert: 0,
							});
							return;
						}
						const oldTimer = displayTimers.get(id);
						if (oldTimer) {
							yield* Fiber.interrupt(oldTimer);
							displayTimers.delete(id);
						}
						const expired =
							previous?.alert === 2 || previous?.countdownPhase === "expired";
						yield* feedback({
							...event,
							countdown: event.time,
							countdownPhase:
								event.time < 0
									? expired
										? "expired"
										: "hidden"
									: event.time === 0
										? "expired"
										: "running",
							...(event.time > 0 ? { endAt: now + event.time } : {}),
						});
						if (event.time > 0 && !running.has(id)) {
							const end = now + event.time;
							const tick = Effect.gen(function* () {
								let remaining = event.time;
								while (remaining > 0) {
									yield* Effect.sleep(Math.min(1000, remaining));
									remaining = Math.max(
										0,
										end - (yield* Clock.currentTimeMillis),
									);
									yield* feedback({
										...event,
										countdown: remaining,
										countdownPhase: remaining > 0 ? "running" : "expired",
									});
								}
							}).pipe(
								Effect.ensuring(Effect.sync(() => displayTimers.delete(id))),
							);
							displayTimers.set(id, yield* Effect.forkIn(tick, scope));
						}
					}
				}
			});

			const panelMessage = Effect.fn("KeyRuntime.panelMessage")(function* (
				deviceId: string,
				input: unknown,
			): Effect.fn.Return<void, ActionError> {
				const decoded = Schema.decodeUnknownEither(KeyPanelMessage)(input);
				if (decoded._tag === "Left")
					return yield* new InvalidKeyAction("activation", decoded.left);
				const message = decoded.right;
				if (message.type === "globalAlert") return;
				const env = yield* port.read;
				if (!env.activeByDevice[deviceId]) return;
				if (message.type === "slide")
					return yield* navigate(deviceId, message.direction);
				if (message.type === "functionKeyPressed")
					return yield* port.execute({
						type: "managementCenter",
						actions: message.tabType
							? [{ type: "tabType", value: message.tabType }]
							: [],
					});
				if (message.deviceId === deviceId) yield* displayEvent(message);
			});

			const preparePlayerControl = Effect.fn("KeyRuntime.preparePlayerControl")(
				function* (
					activation: KeyActivation & { readonly keyCode: string },
					intent: "previous" | "toggle" | "next" | "stop",
				): Effect.fn.Return<Effect.Effect<void, ActionError>, ActionError> {
					const { profile, page } = current(
						yield* port.read,
						activation.deviceId,
					);
					if (
						profile.id !== activation.profileId ||
						page.id !== activation.pageId ||
						profile.revision !== activation.revision
					)
						return Effect.void;
					const key = page.keys.find(
						(key) => key.keyCode === activation.keyCode && key.config.display,
					);
					if (
						!key ||
						isUnsupportedProfileKey(key) ||
						!["playAudio", "playAudioLegacy"].includes(key.config.type) ||
						!key.config.actions.some(
							(action) =>
								action.type === "sound" &&
								typeof action.value === "string" &&
								action.value.length > 0,
						) ||
						!port.executeOwned ||
						key.config.actions.some(
							(a) => a.type === "musicSource" && a.value === "system",
						)
					)
						return yield* new KeyFunctionUnavailable("owning-runtime");
					const control = JSON.stringify([
						activation.deviceId,
						activation.keyCode,
					]);
					if (ownedControls.has(control)) return Effect.void;
					ownedControls.add(control);
					const operation = { previous: 5, toggle: 0, next: 6, stop: 4 }[
						intent
					];
					const controlled = {
						...key,
						config: {
							...key.config,
							actions: [
								...key.config.actions.filter(
									(action) => action.type !== "audioAction",
								),
								{ type: "audioAction", value: operation },
								{ type: "playerIntent", value: intent },
							],
						},
					};
					const execute = port.executeOwned;
					let fiber: Fiber.RuntimeFiber<void, ActionError>;
					fiber = yield* Effect.forkIn(
						Effect.yieldNow().pipe(
							Effect.zipRight(execute(controlled, activation)),
							Effect.flatMap((handled) =>
								handled
									? Effect.void
									: Effect.fail(new KeyFunctionUnavailable("owning-runtime")),
							),
							Effect.ensuring(
								Effect.sync(() => {
									owned.delete(fiber);
									ownedControls.delete(control);
								}),
							),
						),
						scope,
					);
					owned.set(fiber, activation.deviceId);
					return Fiber.join(fiber);
				},
			);

			const reset = Effect.fn("KeyRuntime.reset")(function* (
				deviceId?: string,
			): Effect.fn.Return<void, ActionError> {
				let releaseError: ActionError | undefined;
				for (const [id, contact] of contacts) {
					if (deviceId && contact.activation.deviceId !== deviceId) continue;
					if (contact.release) {
						const result = yield* Effect.either(contact.release);
						if (Either.isLeft(result)) {
							releaseError ??= result.left;
							continue;
						}
					}
					contacts.delete(id);
				}
				for (const [id, press] of audioPresses)
					if (!deviceId || press.deviceId === deviceId) audioPresses.delete(id);
				for (const [fiber, owner] of owned)
					if (!deviceId || owner === deviceId) yield* Fiber.interrupt(fiber);
				if (port.resetOwned) yield* port.resetOwned(deviceId);
				for (const [key, owner] of running)
					if (!deviceId || JSON.parse(key)[0] === deviceId) {
						yield* Fiber.interrupt(owner.fiber);
						running.delete(key);
					}

				for (const [id, fiber] of displayTimers)
					if (!deviceId || JSON.parse(id)[0] === deviceId) {
						yield* Fiber.interrupt(fiber);
						displayTimers.delete(id);
					}
				for (const map of [
					clearedAt,
					timerTaps,
					alertVersions,
					progressVersions,
				])
					for (const id of map.keys())
						if (!deviceId || JSON.parse(id)[0] === deviceId) map.delete(id);
				if (deviceId) returnContexts.delete(deviceId);
				else returnContexts.clear();
				for (const [id, value] of states)
					if (!deviceId || value.deviceId === deviceId) {
						yield* port.publish({
							...value,
							icon: "",
							alternate: 0,
							countdown: -1,
							countdownPhase: "hidden",
							progress: -1,
							alert: 0,
						});
						states.delete(id);
					}

				for (const key of held)
					if (!deviceId || JSON.parse(key)[0] === deviceId) held.delete(key);
				for (const key of alternates.keys())
					if (!deviceId || JSON.parse(key)[0] === deviceId)
						alternates.delete(key);
				if (releaseError) return yield* Effect.fail(releaseError);
			});
			const prepareActivation = (...args: Parameters<typeof activate>) =>
				Effect.gen(function* () {
					// Physical callers omit expected. Capture their owner while input is
					// locked, before any deferred work can outlive the selected page.
					const env = yield* port.read;
					const { profile, page } = current(env, args[0]);
					const target = args[3] ??
						contacts.get(JSON.stringify([args[0], args[1]]))?.activation ?? {
							profileId: profile.id,
							pageId: page.id,
							revision: profile.revision,
						};
					const report = (_error: ActionError) =>
						feedback({
							deviceId: args[0],
							...target,
							keyCode: args[1],
							alert: 1,
						});
					const work = yield* activate(...args).pipe(Effect.tapError(report));
					return (work ?? Effect.void).pipe(Effect.tapError(report));
				}).pipe(lock.withPermits(1));

			yield* Effect.addFinalizer(() =>
				reset().pipe(
					Effect.retry({ times: 1 }),
					Effect.catchAll((error) => Effect.logWarning(error)),
				),
			);
			return {
				/** Reserve guarded input; await its completion after caller locks release. */
				prepareActivation,
				preparePlayerControl: (
					...args: Parameters<typeof preparePlayerControl>
				) => preparePlayerControl(...args).pipe(lock.withPermits(1)),
				activate: (...args: Parameters<typeof activate>) =>
					prepareActivation(...args).pipe(Effect.flatten),
				navigate: (...args: Parameters<typeof navigate>) =>
					navigate(...args).pipe(lock.withPermits(1)),
				displayEvent: (...args: Parameters<typeof displayEvent>) =>
					displayEvent(...args).pipe(lock.withPermits(1)),
				panelMessage: (...args: Parameters<typeof panelMessage>) =>
					panelMessage(...args).pipe(lock.withPermits(1)),
				refresh,
				snapshot: Effect.sync(() => [...states.values()]),
				reset: (deviceId?: string) => reset(deviceId).pipe(lock.withPermits(1)),
			};
		}),
	},
) {}

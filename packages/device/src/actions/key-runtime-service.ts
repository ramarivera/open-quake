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
	GoToPageConfig,
	HotkeySwitchConfig,
	MultiActionConfig,
	NextPageConfig,
	PreviousPageConfig,
	TimerConfig,
} from "./action-contracts.js";
import {
	type ActionError,
	InvalidKeyAction,
	KeyFunctionUnavailable,
} from "./action-errors.js";
import { validateAction } from "./action-invariants.js";
import type { ActionConfig } from "./action-registry.js";
import { isObsId } from "./obs-contracts.js";
export interface KeyFeedback {
	readonly deviceId: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly keyCode: string;
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
export class KeyRuntimePort extends Context.Tag(
	"@open-quake/device/KeyRuntimePort",
)<
	KeyRuntimePort,
	{
		readonly read: Effect.Effect<ProfileEnvelope, ActionError>;
		readonly execute: (
			config: ActionConfig,
		) => Effect.Effect<void, ActionError>;
		/** Host integrations receive only the committed key after activation guards. */
		readonly executeOwned?: (
			key: ProfileKey,
			activation: KeyActivation,
		) => Effect.Effect<boolean, ActionError>;
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
				running = new Map<string, Fiber.RuntimeFiber<void, never>>();
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
					const value = {
						...states.get(stateId(state)),
						...state,
						...(!visible ? { alert: 0 as const } : {}),
					};
					states.set(stateId(state), value);
					if (visible) yield* port.publish(value);
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
						value.pageId === page.id
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
				const visible = env.profiles.filter(
					(p) =>
						!hidden.includes(p.id) && p.pages.some((page) => page.keys.length),
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
				};
				const input = Schema.encodeSync(ProfileKey)(key).config;
				const type = key.config.type;
				const localAudio =
					type === "playAudio" ||
					type === "playAudioLegacy" ||
					type === "stopAudio";
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
				if (type === "hotkeySwitch") {
					const decoded = Schema.decodeUnknownEither(HotkeySwitchConfig)(input);
					if (decoded._tag === "Left")
						return yield* Effect.fail(
							new InvalidKeyAction("config.actions", decoded.left),
						);
					const state = alternates.get(identity) ?? 0;
					yield* port.execute({
						type: "hotkey",
						actions: [decoded.right.actions[state]],
					});
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
					const previous = running.get(identity);
					if (previous) {
						running.delete(identity);
						yield* Fiber.interrupt(previous);
						yield* feedback({
							...base,
							countdown: -1,
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
						work = Effect.gen(function* () {
							const end = (yield* Clock.currentTimeMillis) + duration;
							yield* feedback({ ...base, countdown: duration, alert: 0 });
							let remaining = duration;
							while (remaining > 0) {
								yield* Effect.sleep(Math.min(1000, remaining));
								remaining = Math.max(0, end - (yield* Clock.currentTimeMillis));
								if (remaining > 0)
									yield* feedback({ ...base, countdown: remaining });
							}
							yield* feedback({ ...base, countdown: -1, alert: 2 });
							if (typeof sound === "string" && sound)
								yield* port.alarm(deviceId, sound);
						});
					} else {
						const decoded =
							Schema.decodeUnknownEither(MultiActionConfig)(input);
						if (decoded._tag === "Left")
							return yield* Effect.fail(
								new InvalidKeyAction("config.actions", decoded.left),
							);
						// Validate the entire sequence before the first host effect.
						for (const step of decoded.right.subActions)
							if (
								step.config.type !== "delay" &&
								validateAction(step.config.type, step.config)._tag === "Left"
							)
								return yield* Effect.fail(
									new InvalidKeyAction("config.actions"),
								);
						work = Effect.gen(function* () {
							const steps = decoded.right.subActions;
							yield* feedback({ ...base, progress: 0, alert: 0 });
							for (let i = 0; i < steps.length; i++) {
								const config = steps[i]?.config;
								if (!config) continue;
								if (config.type === "delay")
									yield* Effect.sleep(config.actions[0].value);
								else {
									const action = validateAction(config.type, config);
									if (action._tag === "Left")
										return yield* Effect.fail(action.left);
									yield* port.execute(action.right);
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
					running.set(identity, fiber);
					return;
				}
				if (
					(type === "homeAssistant" || localAudio || isObsId(type)) &&
					port.executeOwned
				) {
					if (ownedControls.has(control)) return;
					if (isObsId(type)) {
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
				const action = validateAction(
					Option.getOrElse(key.childrenName, () => type),
					input,
				);
				if (action._tag === "Left") return yield* Effect.fail(action.left);
				yield* port.execute(action.right);
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
				for (const [key, fiber] of running)
					if (!deviceId || JSON.parse(key)[0] === deviceId) {
						yield* Fiber.interrupt(fiber);
						running.delete(key);
					}

				for (const [id, value] of states)
					if (!deviceId || value.deviceId === deviceId) {
						yield* port.publish({
							...value,
							alternate: 0,
							countdown: -1,
							progress: 100,
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
				activate(...args).pipe(
					lock.withPermits(1),
					Effect.map((work) => work ?? Effect.void),
				);
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
				refresh,
				snapshot: Effect.sync(() => [...states.values()]),
				reset: (deviceId?: string) => reset(deviceId).pipe(lock.withPermits(1)),
			};
		}),
	},
) {}

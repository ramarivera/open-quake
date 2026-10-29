import { platform } from "node:os";
import {
	Cause,
	Effect,
	Exit,
	Layer,
	Option,
	Queue,
	Runtime,
	Schema,
} from "effect";
import { clipboard, shell } from "electron";
import type {
	ActionHostAdapters,
	KeyboardActionAdapter,
	MediaActionAdapter,
} from "../../../../../packages/device/src/actions/action-adapters.js";
import {
	HOTKEY_KEYS,
	HOTKEY_MODIFIERS,
	HotkeyConfig,
	MediaCommand,
} from "../../../../../packages/device/src/actions/action-contracts.js";
import {
	ActionApplicationMissing,
	ActionPermissionDenied,
	ActionSnapshotFailed,
	HostActionFailed,
	InvalidKeyAction,
	KeyFunctionUnavailable,
} from "../../../../../packages/device/src/actions/action-errors.js";
import { executeActionLeaf } from "../../../../../packages/device/src/actions/action-service.js";
import {
	type KeyActivation,
	type KeyFeedback,
	KeyRuntimePort,
	unavailablePluginAction,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import {
	executeHardwareKey,
	HardwareKeyConfig,
	isHardwareKey,
} from "../../../../../packages/device/src/hardware/hardware-actions.js";
import { encodeDeviceChord } from "../../../../../packages/device/src/hardware/hardware-invariants.js";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard.js";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service.js";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileKey as ProfileKeySchema } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	hostKeyboardAdapter,
	hostKeyboardAvailable,
} from "../hardware/host-keyboard";
import {
	type NativeApplicationPort,
	runApplicationAction,
} from "../profiles/native-actions";
import { validateSequenceAudio } from "../soundboard/key-actions";
import { playKeyAlarm } from "./alarm";
import {
	captureScreenshots,
	lockWorkstation,
	nativeApplicationPort,
	type ScreenshotPort,
	screenshotPort,
} from "./native-host";

const isActionError = Schema.is(
	Schema.Union(
		ActionApplicationMissing,
		ActionPermissionDenied,
		ActionSnapshotFailed,
		HostActionFailed,
		InvalidKeyAction,
		KeyFunctionUnavailable,
	),
);
export interface DesktopKeyRuntimeActions {
	readonly keyboard?: KeyboardActionAdapter;
	readonly dismissSystemOverview?: (deviceId: string) => Promise<boolean>;
	readonly systemOverview?: (deviceId: string) => void;
	readonly application?: NativeApplicationPort;
	readonly screenshots?: ScreenshotPort;
	readonly lock?: () => Promise<void>;
	readonly management?: (
		tab: "profiles" | "keys" | "agents" | "settings" | undefined,
	) => void;
	readonly plugin?: KeyRuntimePort["Type"]["executePlugin"];
	readonly timerCompleted?: KeyRuntimePort["Type"]["timerCompleted"];
}

export const desktopKeyRuntimePort = (
	hardware: (serial?: string) => HardwareSession | undefined,
	publish: (state: KeyFeedback) => void,
	mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
	executeOwned?: (
		key: ProfileKey,
		signal: AbortSignal,
		activation: KeyActivation,
	) => Promise<boolean>,
	mediaActions?: MediaActionAdapter,
	resetOwned?: (deviceId?: string) => Promise<void>,
	runtimeActions: DesktopKeyRuntimeActions = {},
) =>
	Layer.scoped(
		KeyRuntimePort,
		Effect.gen(function* () {
			const profiles = yield* ProfileService;
			const keyboardFor = (deviceId?: string): KeyboardActionAdapter =>
				runtimeActions.keyboard ?? {
					supportedTokens: new Set([...HOTKEY_KEYS, ...HOTKEY_MODIFIERS]),
					pressChord: Effect.fn("DesktopKeys.pressChord")(function* (
						chord: string,
					) {
						if (mock) return;
						if (chord === "printscreen") {
							yield* Effect.tryPromise({
								try: () =>
									captureScreenshots(
										runtimeActions.screenshots ?? screenshotPort,
									),
								catch: (cause) => new HostActionFailed(cause),
							});
							return;
						}
						if (chord === "command+l" && platform() === "win32") {
							yield* Effect.tryPromise({
								try: () => (runtimeActions.lock ?? lockWorkstation)(),
								catch: (cause) => new HostActionFailed(cause),
							});
							return;
						}
						const session = hardware(deviceId);
						if (!session)
							return yield* Effect.fail(
								new HostActionFailed("keyboard-unavailable"),
							);
						yield* hardwareKeyboardAdapter(
							session,
							hostKeyboardAvailable()
								? Option.some(hostKeyboardAdapter())
								: Option.none(),
						).pressChord(chord);
					}),
				};
			const keyboard = keyboardFor();
			const overviewOpened = (chord: string, deviceId?: string) =>
				Effect.sync(() => {
					if (
						platform() === "darwin" &&
						deviceId &&
						[
							"control+up",
							"control+down",
							"command+alt+escape",
							"command+space",
							"command+shift+4",
						].includes(chord)
					)
						runtimeActions.systemOverview?.(deviceId);
				});
			if (!mock && mediaActions?.observe) {
				const changes = yield* Queue.sliding<{
					readonly level: number;
					readonly muted: boolean;
				}>(1);
				yield* Effect.acquireRelease(
					Effect.sync(() =>
						mediaActions.observe?.((reading) => changes.unsafeOffer(reading)),
					),
					(off) => Effect.sync(() => off?.()),
				);
				yield* Effect.forkScoped(
					Effect.forever(
						Effect.gen(function* () {
							const reading = yield* Queue.take(changes);
							const { envelope } = yield* profiles.loadProfiles();
							for (const [deviceId, selection] of Object.entries(
								envelope.activeByDevice,
							)) {
								const profile = envelope.profiles.find(
									(p) => p.id === selection.profileId,
								);
								if (!profile) continue;
								const page = profile.pages.find(
									(p) => p.id === selection.pageId,
								);
								for (const key of page?.keys ?? [])
									if (
										key.config.display &&
										(key.config.type === "mute" || key.config.type === "vol")
									)
										publish({
											deviceId,
											...selection,
											keyCode: key.keyCode,
											revision: profile.revision,
											volume: reading.level,
											muted: reading.muted,
											...(key.config.type === "mute"
												? { alternate: reading.muted ? 1 : 0 }
												: {}),
										});
							}
						}).pipe(Effect.catchAll((error) => Effect.logWarning(error))),
					),
				);
			}
			const textLock = yield* Effect.makeSemaphore(1);
			const adapters: ActionHostAdapters["Type"] = {
				keyboard: Option.some(keyboard),
				text: Option.some({
					insertText: Effect.fn("DesktopKeys.insertText")(function* (
						text: string,
					) {
						if (mock) return;
						yield* Effect.gen(function* () {
							const supported = new Set([
								"text/plain",
								"text/html",
								"text/rtf",
								"image/png",
							]);
							const formats = yield* Effect.try({
								try: () => clipboard.availableFormats(),
								catch: (cause) => new HostActionFailed(cause),
							});
							if (formats.some((format) => !supported.has(format)))
								return yield* Effect.fail(
									new HostActionFailed("unsupported-clipboard-format"),
								);
							const before = yield* Effect.try({
								try: () => ({
									text: clipboard.readText(),
									html: clipboard.readHTML(),
									rtf: clipboard.readRTF(),
									image: clipboard.readImage(),
								}),
								catch: (cause) => new HostActionFailed(cause),
							});
							yield* Effect.uninterruptibleMask((restore) =>
								Effect.gen(function* () {
									let installed = false;
									const result = yield* Effect.exit(
										restore(
											Effect.try({
												try: () => {
													clipboard.clear();
													clipboard.writeText(text);
													installed = true;
												},
												catch: (cause) => new HostActionFailed(cause),
											}).pipe(
												Effect.zipRight(
													keyboard.pressChord(
														process.platform === "darwin"
															? "command+v"
															: "control+v",
													),
												),
												Effect.zipRight(Effect.sleep(50)),
											),
										),
									);
									const cleanup = yield* Effect.exit(
										Effect.try({
											try: () => {
												const formats = clipboard.availableFormats();
												const ours =
													clipboard.readText() === text &&
													formats.every((format) => format === "text/plain");
												// Failed clear/write may leave an empty clipboard. Successful
												// paste cleanup never overwrites a concurrent user edit.
												if (ours || (!installed && formats.length === 0))
													clipboard.write(before);
											},
											catch: (cause) => new HostActionFailed(cause),
										}),
									);
									if (Exit.isFailure(result) && Exit.isFailure(cleanup))
										return yield* Effect.failCause(
											Cause.sequential(result.cause, cleanup.cause),
										);
									yield* cleanup;
									yield* result;
								}),
							);
						}).pipe(textLock.withPermits(1));
					}),
				}),
				media: mock ? Option.none() : Option.fromNullable(mediaActions),
				website: Option.some({
					openUrl: (url) =>
						mock
							? Effect.void
							: Effect.tryPromise({
									try: () => shell.openExternal(url),
									catch: (cause) => new HostActionFailed(cause),
								}),
				}),
				application: Option.some({
					launchApplication: Effect.fn("DesktopKeys.launchApplication")(
						function* (
							reference: string,
						): Effect.fn.Return<
							void,
							HostActionFailed | KeyFunctionUnavailable
						> {
							if (mock) return;
							yield* Effect.tryPromise({
								try: (signal) =>
									runApplicationAction(
										runtimeActions.application ?? nativeApplicationPort,
										platform() === "darwin"
											? "darwin"
											: platform() === "win32"
												? "win32"
												: "linux",
										reference,
										"open",
										false,
										signal,
									),
								catch: (cause) =>
									cause instanceof KeyFunctionUnavailable
										? cause
										: new HostActionFailed(cause),
							});
						},
					),
				}),
			};
			return {
				interceptDown: (deviceId) =>
					runtimeActions.dismissSystemOverview
						? Effect.tryPromise({
								try: () =>
									runtimeActions.dismissSystemOverview?.(deviceId) ??
									Promise.resolve(false),
								catch: (cause) => new HostActionFailed(cause),
							})
						: Effect.succeed(false),
				validateSequenceAudio: (config) =>
					validateSequenceAudio(config).pipe(
						Effect.mapError(
							(cause) => new InvalidKeyAction("config.actions", cause),
						),
					),
				read: profiles.loadProfiles().pipe(
					Effect.map((r) => r.envelope),
					Effect.catchTags({
						ProfileReadFailed: (c) => Effect.fail(new ActionSnapshotFailed(c)),
						ProfileWriteFailed: (c) => Effect.fail(new ActionSnapshotFailed(c)),
						ProfileValidationFailed: (c) =>
							Effect.fail(new ActionSnapshotFailed(c)),
						ProfileNotFound: (c) => Effect.fail(new ActionSnapshotFailed(c)),
						ProfileRevisionConflict: (c) =>
							Effect.fail(new ActionSnapshotFailed(c)),
					}),
				),
				execute: (config, deviceId) =>
					Effect.gen(function* () {
						if (isHardwareKey(config.type)) {
							const decoded =
								Schema.decodeUnknownEither(HardwareKeyConfig)(config);

							return yield* decoded._tag === "Left"
								? Effect.fail(new HostActionFailed(decoded.left))
								: Effect.gen(function* () {
										const owner = hardware(deviceId);
										if (
											config.type === "gameMode" &&
											owner &&
											!mock &&
											(yield* owner.snapshot()).inputMode === "device" &&
											!hostKeyboardAvailable()
										)
											return yield* new HostActionFailed(
												"host-keyboard-unavailable",
											);
										return yield* executeHardwareKey(
											decoded.right,
											hardware(deviceId),
											deviceId,
										);
									}).pipe(
										Effect.mapError((cause) => new HostActionFailed(cause)),
										Effect.tap(() => {
											if (decoded.right.type !== "gameMode") return Effect.void;
											const path = decoded.right.actions.find(
												(a) => a.type === "path",
											)?.value;
											return Effect.gen(function* () {
												const state = yield* hardware(deviceId)?.snapshot() ??
													Effect.fail(
														new HostActionFailed("hardware-unavailable"),
													);
												if (
													state.inputMode === "device" &&
													typeof path === "string" &&
													path
												)
													yield* adapters.application.pipe(
														Option.match({
															onNone: () =>
																Effect.fail(
																	new HostActionFailed(
																		"application-unavailable",
																	),
																),
															onSome: (adapter) =>
																adapter.launchApplication(path),
														}),
													);
											});
										}),
									);
						}
						if (config.type === "managementCenter") {
							if (mock) return;
							if (!runtimeActions.management)
								return yield* new HostActionFailed("management-unavailable");
							yield* Effect.sync(() =>
								runtimeActions.management?.(config.actions[0]?.value),
							);
							return;
						}
						if (config.type === "close") {
							if (mock) return;
							yield* Effect.tryPromise({
								try: (signal) =>
									runApplicationAction(
										runtimeActions.application ?? nativeApplicationPort,
										platform() === "darwin"
											? "darwin"
											: platform() === "win32"
												? "win32"
												: "linux",
										config.actions[0].value,
										"close",
										config.actions[1].value === 1 ||
											config.actions[1].value === true,
										signal,
									),
								catch: (cause) =>
									cause instanceof KeyFunctionUnavailable
										? cause
										: new HostActionFailed(cause),
							});
							return;
						}
						if (config.type === "screenshot") {
							if (mock) return;
							yield* Effect.tryPromise({
								try: () =>
									captureScreenshots(
										runtimeActions.screenshots ?? screenshotPort,
									),
								catch: (cause) => new HostActionFailed(cause),
							});
							return;
						}
						if (config.type === "lock") {
							if (mock) return;
							yield* Effect.tryPromise({
								try: () => (runtimeActions.lock ?? lockWorkstation)(),
								catch: (cause) => new HostActionFailed(cause),
							});
							return;
						}
						yield* executeActionLeaf(config, {
							...adapters,
							keyboard: Option.some(keyboardFor(deviceId)),
						});
						if (config.type === "hotkey")
							yield* overviewOpened(config.actions[0].value, deviceId);
						if (
							config.type === "cmd" &&
							platform() === "darwin" &&
							deviceId &&
							config.actions[0].value ===
								"if [ -d /System/Applications/Apps.app ]; then open /System/Applications/Apps.app; else open -a Launchpad; fi"
						)
							runtimeActions.systemOverview?.(deviceId);
					}),
				executePlugin: runtimeActions.plugin ?? unavailablePluginAction,
				...(runtimeActions.timerCompleted
					? { timerCompleted: runtimeActions.timerCompleted }
					: {}),
				holdHotkey: (key, activation) =>
					Effect.gen(function* () {
						const decoded = Schema.decodeUnknownEither(HotkeyConfig)(
							Schema.encodeSync(ProfileKeySchema)(key).config,
						);
						if (decoded._tag === "Left")
							return yield* Effect.fail(new HostActionFailed(decoded.left));
						const chord = decoded.right.actions[0].value;
						if (
							chord === "printscreen" ||
							(chord === "command+l" && platform() === "win32")
						) {
							yield* keyboard.pressChord(chord);
							return Effect.void;
						}
						if (Schema.is(MediaCommand)(chord)) {
							yield* executeActionLeaf(
								{ type: "hotkey", actions: [{ type: "key", value: chord }] },
								adapters,
							);
							return Effect.void;
						}
						const encoded = encodeDeviceChord(chord);
						if (encoded._tag === "Left")
							return yield* Effect.fail(new HostActionFailed(encoded.left));

						if (mock) return Effect.void;
						const session = hardware(activation.deviceId);
						if (!session)
							return yield* Effect.fail(
								new HostActionFailed("keyboard-unavailable"),
							);
						const snapshot = yield* session
							.snapshot()
							.pipe(Effect.mapError((cause) => new HostActionFailed(cause)));
						if (snapshot.inputMode === "host")
							return (yield* hostKeyboardAdapter().holdChord(chord)).pipe(
								Effect.tap(() => overviewOpened(chord, activation.deviceId)),
							);
						const release = yield* session
							.holdChord(chord)
							.pipe(Effect.mapError((cause) => new HostActionFailed(cause)));
						return release.pipe(
							Effect.mapError((cause) => new HostActionFailed(cause)),
							Effect.tap(() => overviewOpened(chord, activation.deviceId)),
						);
					}),
				executeOwned: (key, activation) =>
					(mock || !executeOwned
						? Effect.succeed(false)
						: Effect.tryPromise({
								try: (signal) => executeOwned(key, signal, activation),
								catch: (cause) => {
									// A runtime rejects with FiberFailure, not the catalog leaf.
									const failure = Runtime.isFiberFailure(cause)
										? Option.getOrElse(
												Cause.failureOption(cause[Runtime.FiberFailureCauseId]),
												() => cause,
											)
										: cause;
									const original = Cause.originalError(failure);
									return isActionError(original)
										? original
										: new HostActionFailed(original);
								},
							})
					).pipe(Effect.withSpan("DesktopKeys.executeOwned")),
				resetOwned: (deviceId) =>
					resetOwned ? Effect.promise(() => resetOwned(deviceId)) : Effect.void,
				publish: (state) => Effect.sync(() => publish(state)),
				select: (deviceId, profileId, pageId) =>
					profiles.selectProfile({ deviceId, profileId, pageId }).pipe(
						Effect.asVoid,
						Effect.catchTags({
							ProfileReadFailed: (c) =>
								Effect.fail(new ActionSnapshotFailed(c)),
							ProfileWriteFailed: (c) =>
								Effect.fail(new ActionSnapshotFailed(c)),
							ProfileValidationFailed: (c) =>
								Effect.fail(new ActionSnapshotFailed(c)),
							ProfileNotFound: (c) => Effect.fail(new ActionSnapshotFailed(c)),
							ProfileRevisionConflict: (c) =>
								Effect.fail(new ActionSnapshotFailed(c)),
						}),
					),
				alarm: (_deviceId, sound) =>
					mock
						? Effect.void
						: Effect.tryPromise({
								try: (signal) => playKeyAlarm(sound, signal),
								catch: (cause) => new HostActionFailed(cause),
							}),
			};
		}),
	);

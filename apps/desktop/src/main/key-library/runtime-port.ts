import { platform } from "node:os";
import { Effect, Layer, Option, Queue, Schema } from "effect";
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
	ActionSnapshotFailed,
	HostActionFailed,
} from "../../../../../packages/device/src/actions/action-errors.js";
import { executeActionLeaf } from "../../../../../packages/device/src/actions/action-service.js";
import {
	type KeyActivation,
	type KeyFeedback,
	KeyRuntimePort,
	unavailablePluginAction,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { encodeDeviceChord } from "../../../../../packages/device/src/hardware/hardware-invariants.js";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard.js";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service.js";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileKey as ProfileKeySchema } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	type NativeApplicationPort,
	runApplicationAction,
} from "../profiles/native-actions";
import { playKeyAlarm } from "./alarm";
import {
	captureScreenshots,
	lockWorkstation,
	nativeApplicationPort,
	type ScreenshotPort,
	screenshotPort,
} from "./native-host";
export interface DesktopKeyRuntimeActions {
	readonly keyboard?: KeyboardActionAdapter;
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
	hardware: () => HardwareSession | undefined,
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
			const keyboard = runtimeActions.keyboard ?? {
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
					const session = hardware();
					if (!session)
						return yield* Effect.fail(
							new HostActionFailed("keyboard-unavailable"),
						);
					yield* hardwareKeyboardAdapter(session).pressChord(chord);
				}),
			};
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
								const page = envelope.profiles
									.find((p) => p.id === selection.profileId)
									?.pages.find((p) => p.id === selection.pageId);
								for (const key of page?.keys ?? [])
									if (
										key.config.display &&
										(key.config.type === "mute" || key.config.type === "vol")
									)
										publish({
											deviceId,
											...selection,
											keyCode: key.keyCode,
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
							const formats = clipboard.availableFormats();
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
							yield* Effect.acquireUseRelease(
								Effect.try({
									try: () => {
										clipboard.clear();
										clipboard.writeText(text);
									},
									catch: (cause) => new HostActionFailed(cause),
								}),
								() =>
									keyboard
										.pressChord(
											process.platform === "darwin" ? "command+v" : "control+v",
										)
										.pipe(Effect.zipRight(Effect.sleep(50))),
								() =>
									Effect.sync(() => {
										if (
											clipboard.readText() === text &&
											clipboard
												.availableFormats()
												.every((format) => format === "text/plain")
										)
											clipboard.write(before);
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
						): Effect.fn.Return<void, HostActionFailed> {
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
								catch: (cause) => new HostActionFailed(cause),
							});
						},
					),
				}),
			};
			return {
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
				execute: (config) =>
					Effect.gen(function* () {
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
								catch: (cause) => new HostActionFailed(cause),
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
						yield* executeActionLeaf(config, adapters);
					}),
				executePlugin: runtimeActions.plugin ?? unavailablePluginAction,
				...(runtimeActions.timerCompleted
					? { timerCompleted: runtimeActions.timerCompleted }
					: {}),
				holdHotkey: (key) =>
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
						const session = hardware();
						if (!session)
							return yield* Effect.fail(
								new HostActionFailed("keyboard-unavailable"),
							);
						const snapshot = yield* session
							.snapshot()
							.pipe(Effect.mapError((cause) => new HostActionFailed(cause)));
						if (snapshot.inputMode !== "device")
							return yield* Effect.fail(
								new HostActionFailed("held-host-keyboard-unavailable"),
							);
						const release = yield* session
							.holdChord(chord)
							.pipe(Effect.mapError((cause) => new HostActionFailed(cause)));
						return release.pipe(
							Effect.mapError((cause) => new HostActionFailed(cause)),
						);
					}),
				executeOwned: (key, activation) =>
					mock || !executeOwned
						? Effect.succeed(false)
						: Effect.tryPromise({
								try: (signal) => executeOwned(key, signal, activation),
								catch: (cause) => new HostActionFailed(cause),
							}),
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

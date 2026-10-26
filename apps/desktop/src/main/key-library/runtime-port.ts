import { execFile } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";
import { Effect, Layer, Option } from "effect";
import { clipboard, shell } from "electron";
import type {
	ActionHostAdapters,
	MediaActionAdapter,
} from "../../../../../packages/device/src/actions/action-adapters.js";
import {
	HOTKEY_KEYS,
	HOTKEY_MODIFIERS,
} from "../../../../../packages/device/src/actions/action-contracts.js";
import {
	ActionSnapshotFailed,
	HostActionFailed,
} from "../../../../../packages/device/src/actions/action-errors.js";
import { executeActionLeaf } from "../../../../../packages/device/src/actions/action-service.js";
import {
	type KeyFeedback,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard.js";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service.js";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { playKeyAlarm } from "./alarm";

const runFile = promisify(execFile);

export const desktopKeyRuntimePort = (
	hardware: () => HardwareSession | undefined,
	publish: (state: KeyFeedback) => void,
	mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
	executeOwned?: (key: ProfileKey, signal: AbortSignal) => Promise<boolean>,
	mediaActions?: MediaActionAdapter,
) =>
	Layer.effect(
		KeyRuntimePort,
		Effect.gen(function* () {
			const profiles = yield* ProfileService;
			const keyboard = {
				supportedTokens: new Set([...HOTKEY_KEYS, ...HOTKEY_MODIFIERS]),
				pressChord: Effect.fn("DesktopKeys.pressChord")(function* (
					chord: string,
				) {
					if (mock) return;
					const session = hardware();
					if (!session)
						return yield* Effect.fail(
							new HostActionFailed("keyboard-unavailable"),
						);
					yield* hardwareKeyboardAdapter(session).pressChord(chord);
				}),
			};
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
									try: () => clipboard.writeText(text),
									catch: (cause) => new HostActionFailed(cause),
								}),
								() =>
									keyboard
										.pressChord(
											process.platform === "darwin" ? "command+v" : "control+v",
										)
										.pipe(Effect.zipRight(Effect.sleep(150))),
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
							if (reference.slice(0, 4).toLowerCase() === "app:") {
								if (platform() !== "darwin")
									return yield* Effect.fail(
										new HostActionFailed(
											"application-reference-platform-unavailable",
										),
									);
								yield* Effect.tryPromise({
									try: () =>
										runFile("/usr/bin/open", ["-b", reference.slice(4)]),
									catch: (cause) => new HostActionFailed(cause),
								});
								return;
							}
							const error = yield* Effect.tryPromise({
								try: () => shell.openPath(reference),
								catch: (cause) => new HostActionFailed(cause),
							});
							if (error) return yield* Effect.fail(new HostActionFailed(error));
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
				execute: (config) => executeActionLeaf(config, adapters),
				executeOwned: (key) =>
					mock || !executeOwned
						? Effect.succeed(false)
						: Effect.tryPromise({
								try: (signal) => executeOwned(key, signal),
								catch: (cause) => new HostActionFailed(cause),
							}),
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

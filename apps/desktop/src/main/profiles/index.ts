import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Option, Schedule, Schema, Stream } from "effect";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { MediaActionAdapter } from "../../../../../packages/device/src/actions/action-adapters";
import { KeyRuntime } from "../../../../../packages/device/src/actions/key-runtime-service.js";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service.js";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service.js";
import {
	builtinProfiles,
	translateProfile,
} from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	type ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileDeliveryFailed,
	ProfileNotFound,
	ProfileThumbnailFailed,
	ProfileThumbnailUnsupported,
} from "../../../../../packages/device/src/profiles/profile-errors.js";
import type {
	ProfileLocale,
	ProfilePlatform,
} from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import { KEY_RUNTIME } from "../../shared/key-library";
import {
	PROFILE_PROGRESS,
	PROFILE_REQUEST,
	PROFILE_SELECTION,
	PROFILE_SNAPSHOT,
	type ProfileReply,
	ProfileRequest,
} from "../../shared/profile-manager";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { registerKeyLibrary } from "../key-library/registration";
import { desktopKeyRuntimePort } from "../key-library/runtime-port";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { encodeRendererProfile } from "./clock-profile-projection";
import { makeScopedForegroundProbe } from "./foreground-app";
import {
	canonicalProfileAppPath,
	loadInstalledProfileApps,
} from "./installed-apps";
import { createDesktopProfileStorage } from "./local-profile-storage";
import {
	launchProfileCommand,
	profileApplicationDialog,
} from "./native-actions";
import {
	makeProfileController,
	type ProfileSelectionScope,
} from "./profile-controller";
import { registerProfiles as registerProfileSnapshots } from "./profile-ipc";
import { profileRequestAllowed } from "./profile-permissions";
import { createProfileThumbnailStore } from "./profile-thumbnails";
export function prepareProfiles(
	management: () => BrowserWindow | undefined,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	deliver?: (serial: string, profile: Profile) => Promise<void>,
	managementURL = renderer,
	hardware: () => HardwareSession | undefined = () => undefined,
	panel: () => BrowserWindow | undefined = () => undefined,
	executeOwned?: (key: ProfileKey, signal: AbortSignal) => Promise<boolean>,
	diagnostics?: DesktopDiagnostics,
	mediaActions?: MediaActionAdapter,
) {
	const platform: ProfilePlatform =
		process.platform === "darwin"
			? "darwin"
			: process.platform === "win32"
				? "win32"
				: "linux";
	const root = join(app.getPath("userData"), "profiles");
	const data = createDesktopProfileStorage(
		join(app.getPath("userData"), "profiles-v1.json"),
		undefined,
		() =>
			encodeProfileEnvelope(
				Schema.decodeUnknownSync(ProfileEnvelope)({
					schemaVersion: 1,
					profiles: builtinProfiles(platform).map((p) =>
						Schema.encodeSync(Profile)(p),
					),
					activeByDevice: {},
				}),
			),
	);
	const storage = data;
	const broadcast = (channel: string, value: unknown): void => {
		for (const win of BrowserWindow.getAllWindows())
			if (!win.isDestroyed() && !win.webContents.isDestroyed())
				win.webContents.send(channel, value);
	};
	const profileLive = Layer.mergeAll(
		ProfileService.DefaultWithoutDependencies,
		ProfileManager.DefaultWithoutDependencies,
		ProfileSwitching.DefaultWithoutDependencies,
	).pipe(
		Layer.provideMerge(
			ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(profileStorageLayer(storage)),
				Layer.provide(ManagementProfileContractsLive),
			),
		),
		Layer.provide(
			Layer.scoped(
				ProfileSwitchingPort,
				Effect.gen(function* () {
					const foreground =
						process.env.OPEN_QUAKE_MOCK_DEVICE === "1"
							? () => Effect.succeed(Option.none())
							: yield* makeScopedForegroundProbe(platform);
					return {
						platform,
						foreground,
						push: (serial, profile, guard) =>
							Effect.tryPromise({
								try: async () => {
									guard?.();
									await deliver?.(serial, profile);
									guard?.();
									broadcast(PROFILE_SELECTION, {
										serial,
										profile: encodeRendererProfile(profile),
										hardware: "unverified",
									});
								},
								catch: ProfileDeliveryFailed.fromCause,
							}),
					};
				}),
			),
		),
	);

	const prepared = prepareDesktopModule(
		Layer.mergeAll(
			KeyEditing.DefaultWithoutDependencies,
			KeyRuntime.DefaultWithoutDependencies.pipe(
				Layer.provide(
					desktopKeyRuntimePort(
						hardware,
						(state) => broadcast(KEY_RUNTIME, state),
						undefined,
						executeOwned,
						mediaActions,
					),
				),
			),
		).pipe(Layer.provideMerge(profileLive)),
		(runtime) => {
			const keyLibrary = registerKeyLibrary(
				runtime,
				management,
				renderer,
				managementURL,
				panel,
			);
			const snapshots = registerProfileSnapshots(runtime, renderer, false);
			const localeListeners = new Set<() => void>();
			const captureWindows = new Set<BrowserWindow>();
			const captureProfiles = new Map<Electron.WebContents, Profile>();
			const thumbnails = createProfileThumbnailStore(root);
			const thumbnailLock = Effect.unsafeMakeSemaphore(1);
			const cachedThumbnail = thumbnails.read;
			const capture = async (
				profile: Profile,
				locale: ProfileLocale,
				signal?: AbortSignal,
			): Promise<string> => {
				signal = signal
					? AbortSignal.any([signal, AbortSignal.timeout(10000)])
					: AbortSignal.timeout(10000);
				signal.throwIfAborted();
				if (disposed) throw new Error("Profile manager disposed");
				const window = new BrowserWindow({
					show: false,
					width: 960,
					height: 240,
					useContentSize: true,
					webPreferences: {
						preload: join(import.meta.dirname, "../preload/index.mjs"),
						sandbox: false,
						contextIsolation: true,
						nodeIntegration: false,
					},
				});
				const abort = () => {
					if (!window.isDestroyed()) window.destroy();
				};
				signal?.addEventListener("abort", abort, { once: true });
				captureWindows.add(window);
				captureProfiles.set(window.webContents, profile);
				try {
					const url = new URL(renderer);
					url.searchParams.set("surface", "profile-thumbnail");
					url.searchParams.set("profile", profile.id);
					url.searchParams.set("locale", locale);
					await window.loadURL(url.href);
					signal.throwIfAborted();
					await window.webContents.executeJavaScript(
						`new Promise((resolve,reject)=>{const check=()=>{const preview=document.querySelector("[data-profile-ready]"),stage=preview?.querySelector(".strip-viewport-stage");const emojis=Array.from(preview?.querySelectorAll("[data-emoji-asset-state]")??[]);const emojiReady=emojis.length===${profile.pages[0].keys.filter((key) => key.config.type === "emoji" && key.config.display).length}&&emojis.every(el=>el.dataset.emojiAssetState==="empty"||(el.dataset.emojiAssetState==="ready"&&Array.from(el.querySelectorAll("img")).some(img=>img.complete&&img.naturalWidth>0)));if(preview&&stage&&emojiReady&&(!${profile.pages.some((page) => page.keys.some((key) => key.config.type === "dkDesktopClock"))}||preview.querySelector(".oq-clock"))&&Math.abs(stage.getBoundingClientRect().width-Math.min(preview.clientWidth,preview.clientHeight*4))<1){document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return;}setTimeout(check,20);};check();setTimeout(()=>reject(new Error("Thumbnail generation timed out")),5000);})`,
					);
					const image = await window.webContents.capturePage();
					if (image.isEmpty())
						throw ProfileThumbnailUnsupported.fromCause(undefined);
					const png = image.toPNG();
					signal?.throwIfAborted();
					return await thumbnails.write(profile, locale, png);
				} finally {
					signal?.removeEventListener("abort", abort);
					captureProfiles.delete(window.webContents);
					captureWindows.delete(window);
					if (!window.isDestroyed()) window.destroy();
				}
			};
			let installed:
				| Promise<Awaited<ReturnType<typeof loadInstalledProfileApps>>>
				| undefined;
			const initialize = Effect.gen(function* () {
				yield* (yield* ProfileManager).install(platform);
				return yield* makeProfileController({
					localeChanged: () => {
						for (const listener of localeListeners) listener();
					},
					installedApps: () => {
						installed ??=
							process.env.OPEN_QUAKE_MOCK_DEVICE === "1"
								? Promise.resolve([])
								: loadInstalledProfileApps(platform).catch(() => []);
						return installed;
					},
					confirm: async (message, detail) =>
						(
							await dialog.showMessageBox({
								type: "warning",
								message,
								detail,
								buttons: ["Confirm", "Cancel"],
								defaultId: 1,
								cancelId: 1,
							})
						).response === 0,
					execute: (command) => launchProfileCommand(platform, command),
					chooseApp: async () => {
						const result = await dialog.showOpenDialog(
							profileApplicationDialog(platform),
						);
						const path = result.canceled ? undefined : result.filePaths[0];
						return path
							? Option.some(await canonicalProfileAppPath(platform, path))
							: Option.none();
					},
					capture: (profile, locale) =>
						runtime.runPromise(
							thumbnailLock.withPermits(1)(
								Effect.tryPromise({
									try: (signal) => capture(profile, locale, signal),
									catch: (cause) => ProfileThumbnailFailed.fromCause(cause),
								}),
							),
						),
					cachedThumbnail,
					publish: (view) => broadcast(PROFILE_SNAPSHOT, view),
					progress: (progress) => broadcast(PROFILE_PROGRESS, progress),
				});
			});
			const initializationLock = runtime.runSync(Effect.makeSemaphore(1));
			let initialized: Effect.Effect.Success<typeof initialize> | undefined;
			const controller = Effect.gen(function* () {
				if (initialized) return initialized;
				const service = yield* initialize;
				initialized = service;
				return service;
			}).pipe(initializationLock.withPermits(1));
			const monitor = runtime.runFork(
				Effect.gen(function* () {
					yield* controller.pipe(Effect.retry(Schedule.spaced(2000)));
					yield* (yield* ProfileSwitching).poll;
				}),
			);
			const managerUpdates = runtime.runFork(
				Effect.gen(function* () {
					const service = yield* controller.pipe(
						Effect.retry(Schedule.spaced(2000)),
					);
					const repository = yield* ProfileRepository;
					const prune = Effect.fn("ProfileDesktop.pruneThumbnails")(() =>
						thumbnailLock
							.withPermits(1)(
								repository.transact((envelope) =>
									Effect.tryPromise({
										try: () => thumbnails.prune(envelope.profiles),
										catch: (cause) =>
											cause instanceof ProfileThumbnailFailed
												? cause
												: ProfileThumbnailFailed.fromCause(cause),
									}).pipe(Effect.as(envelope)),
								),
							)
							.pipe(
								Effect.catchTag("ProfileThumbnailFailed", (error) =>
									Effect.logWarning("profiles.thumbnail.cleanup.failed", error),
								),
							),
					);
					yield* Stream.runForEach(repository.snapshots, () =>
						prune()
							.pipe(Effect.zipRight(service.publish()))
							.pipe(
								Effect.matchEffect({
									onSuccess: () => Effect.void,
									onFailure: (error) =>
										Effect.logWarning(
											"Publishing profiles manager snapshot failed",
											{
												code: error.code,
											},
										),
								}),
							),
					);
				}),
			);
			let disposed = false;
			const pending = new Set<Promise<unknown>>();
			ipcMain.handle(
				PROFILE_REQUEST,
				async (event, input: unknown): Promise<ProfileReply> => {
					const decoded = Schema.decodeUnknownEither(ProfileRequest)(input, {
						onExcessProperty: "error",
					});
					if (
						disposed ||
						decoded._tag === "Left" ||
						!BrowserWindow.fromWebContents(event.sender) ||
						!profileRequestAllowed(
							event.senderFrame?.url ?? "",
							renderer,
							event.senderFrame === event.sender.mainFrame,
							event.sender === management()?.webContents,
							decoded.right.type,
							managementURL,
						)
					)
						return { _tag: "rejected", reason: "unauthorized" };
					const operation = runtime.runPromise(
						controller.pipe(
							Effect.flatMap((service) => service.request(decoded.right)),
							Effect.match({
								onSuccess: (reply) => reply,
								onFailure: (error): ProfileReply => ({
									_tag: "rejected",
									reason: error.code,
								}),
							}),
						),
					);
					pending.add(operation);
					try {
						return await operation;
					} finally {
						pending.delete(operation);
					}
				},
			);
			const connect = (serial: string, reported?: string): Promise<void> =>
				runtime.runPromise(
					Effect.gen(function* () {
						yield* controller;
						yield* (yield* ProfileSwitching).connect(serial, reported);
					}),
				);
			const disconnect = (serial: string): Promise<void> =>
				runtime.runPromise(
					Effect.gen(function* () {
						yield* KeyRuntime.reset(serial);
						yield* (yield* ProfileSwitching).disconnect(serial);
					}),
				);
			return {
				runtime,
				/** The profile controller owns this locale, initially en until a non-preview read. */
				currentLocale: (): ProfileLocale =>
					initialized?.currentLocale() ?? "en",
				onLocaleChanged: (listener: () => void): (() => void) => {
					localeListeners.add(listener);
					return () => {
						localeListeners.delete(listener);
					};
				},
				/** Shared cache/capture owner. Captures stay hidden, serial and abortable. */
				thumbnail: (
					id: string,
					locale: ProfileLocale,
					signal: AbortSignal,
				): Promise<string> => {
					const operation = runtime.runPromise(
						thumbnailLock.withPermits(1)(
							Effect.gen(function* () {
								yield* controller;
								const envelope = yield* ProfileManager.read();
								const source = envelope.profiles.find((p) => p.id === id);
								if (!source)
									return yield* Effect.fail(
										ProfileNotFound.fromCause(undefined),
									);
								const profile = translateProfile(source, locale);
								return yield* Effect.tryPromise({
									try: async () => {
										const cached = await cachedThumbnail(profile, locale);
										return Option.isSome(cached)
											? cached.value
											: capture(profile, locale, signal);
									},
									catch: (cause) => ProfileThumbnailFailed.fromCause(cause),
								});
							}),
						),
						{ signal },
					);
					pending.add(operation);
					return operation.finally(() => {
						pending.delete(operation);
					});
				},
				thumbnailProfile: (sender: Electron.WebContents): Profile | undefined =>
					captureProfiles.get(sender),
				/** Shared knob mutations use the manager's visibility, anchor and delivery rules. */
				select: (
					id: string,
					scope?: ProfileSelectionScope,
				): Promise<ProfileEnvelope> =>
					runtime.runPromise(
						controller.pipe(
							Effect.flatMap((service) =>
								service.request(
									{
										type: "manage",
										command: { type: "select", id },
									},
									scope,
								),
							),
							Effect.flatMap((reply) =>
								reply._tag === "rejected"
									? Effect.fail(ProfileNotFound.fromCause(undefined))
									: ProfileManager.read(),
							),
						),
					),
				/** Republish committed state after a compensating cross-store transaction. */
				refresh: (): Promise<void> =>
					runtime
						.runPromise(
							Effect.gen(function* () {
								const envelope = yield* ProfileManager.read();
								const switching = yield* ProfileSwitching;
								for (const serial of yield* switching.connectedSerials()) {
									const selection = envelope.activeByDevice[serial];
									const profile = envelope.profiles.find(
										(profile) => profile.id === selection?.profileId,
									);
									if (profile) yield* switching.deliver(serial, profile);
								}
								yield* (yield* controller).publish();
							}),
						)
						.then(() => undefined),
				connect,
				disconnect,
				resetKeys: () => runtime.runPromise(KeyRuntime.reset()),
				dispose: async (): Promise<void> => {
					if (disposed) return;
					disposed = true;
					ipcMain.removeHandler(PROFILE_REQUEST);
					localeListeners.clear();
					captureProfiles.clear();
					for (const window of captureWindows) window.destroy();
					await Promise.allSettled([...pending]);
					await keyLibrary.dispose();
					await snapshots.dispose();
					await runtime.runPromise(Fiber.interrupt(monitor));
					await runtime.runPromise(Fiber.interrupt(managerUpdates));
					await runtime.dispose();
				},
			};
		},
		diagnostics,
		"app.background",
	);
	return prepared;
}

export function registerProfiles(...args: Parameters<typeof prepareProfiles>) {
	return prepareProfiles(...args).standalone();
}

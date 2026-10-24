import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	Schedule,
	Schema,
	Stream,
} from "effect";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileDeliveryFailed,
	ProfileNotFound,
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
import {
	PROFILE_PROGRESS,
	PROFILE_REQUEST,
	PROFILE_SELECTION,
	PROFILE_SNAPSHOT,
	type ProfileReply,
	ProfileRequest,
} from "../../shared/profile-manager";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { makeForegroundProbe } from "./foreground-app";
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
	profileThumbnailKey,
} from "./profile-controller";
import { registerProfiles as registerProfileSnapshots } from "./profile-ipc";
import { profileRequestAllowed } from "./profile-permissions";
export function registerProfiles(
	management: () => BrowserWindow | undefined,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	deliver?: (serial: string, profile: Profile) => Promise<void>,
	managementURL = renderer,
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
	);
	const storage = {
		...data,
		read: async (): Promise<unknown> => {
			const raw = await data.read();
			// Only an adapter-created fresh seed is replaced. Existing users keep their custom profiles.
			if (data.recoveries.at(-1)?.reason === "seeded") {
				const profiles = builtinProfiles(platform);
				const first = profiles[0];
				if (first)
					return {
						...encodeProfileEnvelope(
							Schema.decodeUnknownSync(ProfileEnvelope)({
								schemaVersion: 1,
								profiles: profiles.map((p) => Schema.encodeSync(Profile)(p)),
								activeByDevice: {},
							}),
						),
					};
			}
			return raw;
		},
	};
	const broadcast = (channel: string, value: unknown): void => {
		for (const win of BrowserWindow.getAllWindows())
			if (!win.isDestroyed() && !win.webContents.isDestroyed())
				win.webContents.send(channel, value);
	};
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
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
				Layer.succeed(ProfileSwitchingPort, {
					platform,
					foreground:
						process.env.OPEN_QUAKE_MOCK_DEVICE === "1"
							? () => Effect.succeed(Option.none())
							: makeForegroundProbe(platform),
					push: (serial, profile) =>
						Effect.tryPromise({
							try: async () => {
								await deliver?.(serial, profile);
								broadcast(PROFILE_SELECTION, {
									serial,
									profile: Schema.encodeSync(Profile)(profile),
									hardware: "unverified",
								});
							},
							catch: ProfileDeliveryFailed.fromCause,
						}),
				}),
			),
		),
	);
	const snapshots = registerProfileSnapshots(runtime, renderer, false);
	const captureWindows = new Set<BrowserWindow>();
	const captureProfiles = new Map<Electron.WebContents, Profile>();
	const thumbnailPath = (profile: Profile, locale: ProfileLocale): string =>
		join(root, "thumbnails", `${profileThumbnailKey(profile, locale)}.png`);
	const cachedThumbnail = async (
		profile: Profile,
		locale: ProfileLocale,
	): Promise<Option.Option<string>> => {
		try {
			return Option.some(
				`data:image/png;base64,${(await readFile(thumbnailPath(profile, locale))).toString("base64")}`,
			);
		} catch (cause) {
			if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
				return Option.none();
			throw cause;
		}
	};
	const capture = async (
		profile: Profile,
		locale: ProfileLocale,
	): Promise<string> => {
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
		captureWindows.add(window);
		captureProfiles.set(window.webContents, profile);
		try {
			const url = new URL(renderer);
			url.searchParams.set("surface", "profile-thumbnail");
			url.searchParams.set("profile", profile.id);
			url.searchParams.set("locale", locale);
			await window.loadURL(url.href);
			await window.webContents.executeJavaScript(
				`new Promise((resolve,reject)=>{const check=()=>{const preview=document.querySelector("[data-profile-ready]"),stage=preview?.querySelector(".strip-viewport-stage");const emojis=Array.from(preview?.querySelectorAll("[data-emoji-asset-state]")??[]);const emojiReady=emojis.length===${profile.pages[0].keys.filter((key) => key.config.type === "emoji" && key.config.display).length}&&emojis.every(el=>el.dataset.emojiAssetState==="ready"&&Array.from(el.querySelectorAll("img")).some(img=>img.complete&&img.naturalWidth>0));if(preview&&stage&&emojiReady&&(!${profile.pages.some((page) => page.keys.some((key) => key.config.type === "dkDesktopClock"))}||preview.querySelector(".oq-clock"))&&Math.abs(stage.getBoundingClientRect().width-preview.clientWidth)<1){document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return;}setTimeout(check,20);};check();setTimeout(()=>reject(new Error("Thumbnail generation timed out")),5000);})`,
			);
			const image = await window.webContents.capturePage();
			if (image.isEmpty())
				throw ProfileThumbnailUnsupported.fromCause(undefined);
			const png = image.toPNG();
			await mkdir(join(root, "thumbnails"), { recursive: true });
			await writeFile(thumbnailPath(profile, locale), png, { mode: 0o600 });
			return image.toDataURL();
		} finally {
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
			capture,
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
			yield* Stream.runForEach(repository.snapshots, () =>
				service.publish().pipe(
					Effect.matchEffect({
						onSuccess: () => Effect.void,
						onFailure: (error) =>
							Effect.logWarning("Publishing profiles manager snapshot failed", {
								code: error.code,
							}),
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
				yield* (yield* ProfileSwitching).disconnect(serial);
			}),
		);
	return {
		runtime,
		thumbnailProfile: (sender: Electron.WebContents): Profile | undefined =>
			captureProfiles.get(sender),
		/** Shared knob mutations use the manager's visibility, anchor and delivery rules. */
		select: (id: string): Promise<ProfileEnvelope> =>
			runtime.runPromise(
				controller.pipe(
					Effect.flatMap((service) =>
						service.request({
							type: "manage",
							command: { type: "select", id },
						}),
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
		dispose: async (): Promise<void> => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(PROFILE_REQUEST);
			captureProfiles.clear();
			for (const window of captureWindows) window.destroy();
			await Promise.allSettled([...pending]);
			await snapshots.dispose();
			await runtime.runPromise(Fiber.interrupt(monitor));
			await runtime.runPromise(Fiber.interrupt(managerUpdates));
			await runtime.dispose();
		},
	};
}

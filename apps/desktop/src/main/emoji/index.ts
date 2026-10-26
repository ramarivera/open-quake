import { join } from "node:path";
import { Effect, Layer, Option, Schema } from "effect";
import { app, type BrowserWindow, ipcMain } from "electron";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard";
import type { Profile } from "../../../../../packages/device/src/profiles/profile-contracts";
import { isUnsupportedProfileKey } from "../../../../../packages/device/src/profiles/profile-function-contracts";
import type { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import {
	EmojiKeyReference,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiClipboardFailed,
	EmojiForegroundFailed,
	EmojiKeyboardFailed,
	EmojiLibraryFailed,
} from "../../../../../packages/edge/src/emoji/emoji-errors";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import {
	EmojiLibrary,
	EmojiPress,
	EmojiPressAdapters,
} from "../../../../../packages/edge/src/emoji/emoji-service";
import {
	decodeEmojiMode,
	EMOJI_PRESS,
	EMOJI_REQUEST,
	EmojiPressRequest,
	type EmojiReply,
	EmojiRequest,
} from "../../shared/emoji";
import { selectStripPage } from "../../shared/strip-selection";
import type { DeviceBus } from "../deviceBus";
import type { DesktopDiagnostics } from "../diagnostics";
import type { DesktopRuntime } from "../diagnostics/module";
import { prepareDesktopModule } from "../diagnostics/module";
import { ImageDecoder } from "../media/image-decoder";
import { makeForegroundProbe } from "../profiles/foreground-app";
import { isAppRenderer } from "../profiles/profile-ipc";
import { copyGifFile } from "./clipboard";
import { type EmojiGenerationPort, makeEmojiController } from "./controller";
import { emojiFiles } from "./files";
import { placeEmojiPackage } from "./profile-placement";
export function prepareEmoji<R>(options: {
	readonly diagnostics?: DesktopDiagnostics;
	readonly management: () => BrowserWindow;
	readonly panel: () => BrowserWindow;
	readonly profiles: {
		readonly runtime: DesktopRuntime<
			R | ProfileService | ProfileRepository,
			never
		>;
		readonly select: (id: string) => Promise<unknown>;
		readonly refresh?: () => Promise<void>;
		readonly thumbnailProfile?: (
			sender: Electron.WebContents,
		) => Profile | undefined;
	};
	readonly bus: () => DeviceBus | undefined;
	readonly renderer: string;
	readonly mock: boolean;
	readonly root?: string;
	readonly generation?: EmojiGenerationPort;
	readonly selectionSerial?: () => Promise<string | undefined>;
	readonly clipboard?: (path: string) => Promise<void>;
	readonly platform?: "darwin" | "win32" | "linux";
}) {
	const files = emojiFiles(
		options.root ?? join(app.getPath("userData"), "emoji-v1"),
	);
	const platform =
		options.platform ??
		(process.platform === "darwin"
			? "darwin"
			: process.platform === "win32"
				? "win32"
				: "linux");
	const foreground = makeForegroundProbe(platform);
	const adapters = Layer.succeed(EmojiPressAdapters, {
		platform,
		foreground: () =>
			foreground().pipe(
				Effect.map(
					Option.map((app) => ({ name: "", path: app.path, identifier: "" })),
				),
				Effect.catchTag("ProfileForegroundFailed", (cause) =>
					Effect.fail(new EmojiForegroundFailed(cause)),
				),
			),
		copyGif: (hash) =>
			Effect.tryPromise({
				try: async () => {
					const path = await files.clipboardPath(hash);
					if (options.clipboard) await options.clipboard(path);
					else if (!options.mock) await copyGifFile(platform, path);
				},
				catch: (cause) => new EmojiClipboardFailed(cause),
			}),
		keyboard: (chord) => {
			const hardware = options.bus()?.hardware?.();
			return hardware
				? hardwareKeyboardAdapter(hardware)
						.pressChord(chord)
						.pipe(
							Effect.catchTag("HostActionFailed", (cause) =>
								Effect.fail(new EmojiKeyboardFailed(cause)),
							),
							Effect.catchTag("ActionApplicationMissing", (cause) =>
								Effect.fail(new EmojiKeyboardFailed(cause)),
							),
							Effect.catchTag("ActionPermissionDenied", (cause) =>
								Effect.fail(new EmojiKeyboardFailed(cause)),
							),
						)
				: Effect.fail(new EmojiKeyboardFailed(undefined));
		},
	});

	const prepared = prepareDesktopModule(
		Layer.mergeAll(
			EmojiLibrary.DefaultWithoutDependencies,
			EmojiPress.DefaultWithoutDependencies,
			ImageDecoder.Default,
		).pipe(
			Layer.provideMerge(
				EmojiRepository.Default.pipe(Layer.provide(emojiStorageLayer(files))),
			),
			Layer.provide(adapters),
		),
		(runtime) => {
			const controller = runtime.runPromise(
				makeEmojiController({
					files,
					management: options.management,
					place: placeEmojiPackage(options.profiles),
					...(options.generation ? { generation: options.generation } : {}),
				}),
			);
			let disposed = false;
			let shutdown: Promise<void> | undefined;
			const pending = new Set<Promise<unknown>>();
			const track = <A>(operation: () => Promise<A>): Promise<A> => {
				const result = operation();
				pending.add(result);
				void result
					.finally(() => pending.delete(result))
					.catch(() => undefined);
				return result;
			};
			const selectedPage = async () => {
				const serial = options.selectionSerial
					? await options.selectionSerial()
					: "desktop-preview";
				const { envelope } = await options.profiles.runtime.runPromise(
					ProfileService.loadProfiles(),
				);
				return selectStripPage(envelope, serial);
			};
			const allowed = (
				event: Electron.IpcMainInvokeEvent,
				write: boolean,
			): boolean =>
				!disposed &&
				event.senderFrame === event.sender.mainFrame &&
				isAppRenderer(event.sender.getURL(), options.renderer) &&
				(event.sender === options.management().webContents ||
					(!write &&
						(event.sender === options.panel().webContents ||
							options.profiles.thumbnailProfile?.(event.sender) !==
								undefined)));
			ipcMain.handle(
				EMOJI_REQUEST,
				(event, input: unknown): Promise<EmojiReply> =>
					track(async () => {
						const decoded = Schema.decodeUnknownOption(EmojiRequest)(input, {
							onExcessProperty: "error",
						});
						if (
							Option.isNone(decoded) ||
							!allowed(
								event,
								decoded.value.type !== "read" && decoded.value.type !== "asset",
							)
						)
							return {
								_tag: "failure",
								code: "QUAKE.EMOJI.REQUEST_DENIED",
								message: "Emoji request denied.",
							};
						if (event.sender !== options.management().webContents) {
							if (decoded.value.type !== "asset") return denied();
							const hash = decoded.value.hash;
							const capture = options.profiles.thumbnailProfile?.(event.sender);
							const selection =
								event.sender === options.panel().webContents
									? await selectedPage().catch(() => undefined)
									: undefined;
							const keys =
								capture?.pages.flatMap((page) => page.keys) ??
								selection?.page.keys;
							if (
								!keys?.some(
									(key) =>
										key.config.type === "emoji" &&
										key.config.display &&
										key.config.icon === `emoji:${hash}`,
								)
							)
								return denied();
							try {
								const bytes = await files.get(hash);
								return {
									_tag: "ready",
									store: emptyEmojiStore,
									assets: {
										[hash]: `data:image/gif;base64,${bytes.toString("base64")}`,
									},
									notice: "",
									apps: [],
								};
							} catch {
								return denied();
							}
						}
						const result = await runtime.runPromise(
							Effect.tryPromise({
								try: () => controller,
								catch: (cause) => new EmojiLibraryFailed(cause),
							}).pipe(
								Effect.flatMap((controller) =>
									controller.request(decoded.value),
								),
								Effect.match({
									onSuccess: (reply) => reply,
									onFailure: (error): EmojiReply => ({
										_tag: "failure",
										code: error.code,
										message: "reason" in error ? error.reason : error.message,
									}),
								}),
							),
						);
						return result;
					}),
			);
			ipcMain.handle(EMOJI_PRESS, (event, input: unknown) =>
				track(async () => {
					const decoded = Schema.decodeUnknownOption(EmojiPressRequest)(input, {
						onExcessProperty: "error",
					});
					if (
						Option.isNone(decoded) ||
						!allowed(event, false) ||
						event.sender !== options.panel().webContents
					)
						return { _tag: "invalid" };
					const request = decoded.value;
					const selected = await selectedPage().catch(() => undefined);
					const found = Option.fromNullable(
						selected?.profile.id === request.profileId &&
							selected.page.id === request.pageId
							? selected.page.keys.find(
									(key) =>
										key.keyCode === request.keyCode &&
										!isUnsupportedProfileKey(key) &&
										key.config.type === "emoji" &&
										key.config.display,
								)
							: undefined,
					);
					if (Option.isNone(found)) return { _tag: "ignored" };
					const ref = Schema.decodeUnknownOption(EmojiKeyReference)(
						found.value.config.actions.find(
							(action) => action.type === "emojiConfig",
						)?.value,
					);
					if (Option.isNone(ref)) return { _tag: "invalid" };
					const mode = decodeEmojiMode(
						found.value.config.actions.find(
							(action) => action.type === "emojiAction",
						)?.value,
					);
					return runtime.runPromise(
						EmojiPress.press(ref.value, mode, request.keyAction).pipe(
							Effect.match({
								onSuccess: (result) => ({
									_tag: result === "ignored" ? "ignored" : "handled",
								}),
								onFailure: () => ({ _tag: "invalid" }),
							}),
						),
					);
				}),
			);
			return {
				runtime,
				dispose: (): Promise<void> => {
					if (shutdown) return shutdown;
					disposed = true;
					ipcMain.removeHandler(EMOJI_REQUEST);
					ipcMain.removeHandler(EMOJI_PRESS);
					shutdown = (async () => {
						await Promise.allSettled([controller, ...pending]);
						try {
							await runtime.dispose();
						} finally {
							await foreground.dispose();
						}
					})();
					return shutdown;
				},
			};
		},
		options.diagnostics,
		"app.background",
	);
	return prepared;
}

export function registerEmoji<R>(
	options: Parameters<typeof prepareEmoji<R>>[0],
) {
	return prepareEmoji(options).standalone();
}
function denied(): EmojiReply {
	return {
		_tag: "failure",
		code: "QUAKE.EMOJI.REQUEST_DENIED",
		message: "Emoji request denied.",
	};
}

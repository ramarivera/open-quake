import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { app, type BrowserWindow, ipcMain } from "electron";
import { hardwareKeyboardAdapter } from "../../../../../packages/device/src/hardware/hardware-keyboard";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { EmojiKeyReference } from "../../../../../packages/edge/src/emoji/emoji-contracts";
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
import type { DeviceBus } from "../deviceBus";
import { ImageDecoder } from "../media/image-decoder";
import type { registerProfiles } from "../profiles";
import { makeForegroundProbe } from "../profiles/foreground-app";
import { isAppRenderer } from "../profiles/profile-ipc";
import { copyGifFile } from "./clipboard";
import { type EmojiGenerationPort, makeEmojiController } from "./controller";
import { emojiFiles } from "./files";
import { placeEmojiPackage } from "./profile-placement";
export function registerEmoji(options: {
	readonly management: () => BrowserWindow;
	readonly panel: () => BrowserWindow;
	readonly profiles: ReturnType<typeof registerProfiles>;
	readonly bus: () => DeviceBus | undefined;
	readonly renderer: string;
	readonly mock: boolean;
	readonly root?: string;
	readonly generation?: EmojiGenerationPort;
}) {
	const files = emojiFiles(
		options.root ?? join(app.getPath("userData"), "emoji-v1"),
	);
	const platform =
		process.platform === "darwin"
			? "darwin"
			: process.platform === "win32"
				? "win32"
				: "linux";
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
					await files.get(hash);
					if (!options.mock) await copyGifFile(platform, files.assetPath(hash));
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
	const runtime = ManagedRuntime.make(
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
	);
	const controller = runtime.runPromise(
		makeEmojiController({
			files,
			management: options.management,
			place: placeEmojiPackage(options.profiles),
			...(options.generation ? { generation: options.generation } : {}),
		}),
	);
	const allowed = (
		event: Electron.IpcMainInvokeEvent,
		write: boolean,
	): boolean =>
		event.senderFrame === event.sender.mainFrame &&
		isAppRenderer(event.sender.getURL(), options.renderer) &&
		(!write || event.sender === options.management().webContents);
	ipcMain.handle(
		EMOJI_REQUEST,
		async (event, input: unknown): Promise<EmojiReply> => {
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
			const result = await runtime.runPromise(
				Effect.tryPromise({
					try: () => controller,
					catch: (cause) => new EmojiLibraryFailed(cause),
				}).pipe(
					Effect.flatMap((controller) => controller.request(decoded.value)),
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
		},
	);
	ipcMain.handle(EMOJI_PRESS, async (event, input: unknown) => {
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
		const found = await options.profiles.runtime
			.runPromise(
				Effect.gen(function* () {
					const { envelope } = yield* ProfileService.loadProfiles();
					const session = options.bus()?.hardware?.();
					const hardware = session
						? yield* session.snapshot().pipe(Effect.option)
						: Option.none();
					const serial = options.mock
						? "desktop-preview"
						: Option.isSome(hardware)
							? hardware.value.serial
							: "";
					const selected = envelope.activeByDevice[serial];
					if (
						selected?.profileId !== request.profileId ||
						selected.pageId !== request.pageId
					)
						return Option.none();
					const profile = envelope.profiles.find(
						(p) => p.id === selected.profileId,
					);
					const page = profile?.pages.find((p) => p.id === selected.pageId);
					return Option.fromNullable(
						page?.keys.find(
							(key) =>
								key.keyCode === request.keyCode &&
								key.config.type === "emoji" &&
								key.config.display,
						),
					);
				}),
			)
			.catch(() => Option.none());
		if (Option.isNone(found)) return { _tag: "ignored" };
		const ref = Schema.decodeUnknownOption(EmojiKeyReference)(
			found.value.config.actions.find((action) => action.type === "emojiConfig")
				?.value,
		);
		if (Option.isNone(ref)) return { _tag: "invalid" };
		const mode = decodeEmojiMode(
			found.value.config.actions.find((action) => action.type === "emojiAction")
				?.value,
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
	});
	return {
		runtime,
		dispose: async () => {
			ipcMain.removeHandler(EMOJI_REQUEST);
			ipcMain.removeHandler(EMOJI_PRESS);
			await runtime.dispose();
		},
	};
}

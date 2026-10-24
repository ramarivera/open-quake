import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Cause, Effect, Option, Runtime } from "effect";
import { type BrowserWindow, dialog } from "electron";
import {
	defaultCaption,
	type EmojiCaption,
	type EmojiItem,
	type EmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiInvalid,
	EmojiLibraryFailed,
} from "../../../../../packages/edge/src/emoji/emoji-errors";
import { weightedLength } from "../../../../../packages/edge/src/emoji/emoji-invariants";
import { EmojiRepository } from "../../../../../packages/edge/src/emoji/emoji-repository";
import { EmojiLibrary } from "../../../../../packages/edge/src/emoji/emoji-service";
import type { EmojiReply, EmojiRequest } from "../../shared/emoji";
import { decodeGif } from "../../shared/gif/index";
import { ImageDecoder } from "../media/image-decoder";
import { loadInstalledProfileApps } from "../profiles/installed-apps";
import type { emojiFiles } from "./files";
export interface EmojiGenerationPort {
	readonly generate: (input: {
		readonly bytes: Uint8Array;
		readonly format: "image/png" | "image/jpeg";
		readonly prompt: string;
	}) => Promise<Uint8Array>;
}
export interface EmojiControllerPort {
	readonly generation?: EmojiGenerationPort;
	readonly files: ReturnType<typeof emojiFiles>;
	readonly management: () => BrowserWindow;
	readonly place: (
		packId: string,
		state: EmojiStore,
		persistLink: (profileId: string) => Promise<void>,
	) => Promise<string>;
}
export const makeEmojiController = Effect.fn("EmojiDesktop.controller")(
	function* (port: EmojiControllerPort) {
		const imageDecoder = yield* ImageDecoder;
		const repository = yield* EmojiRepository;
		const library = yield* EmojiLibrary;
		const lock = yield* Effect.makeSemaphore(1);
		const io = <A>(
			operation: () => Promise<A>,
		): Effect.Effect<A, EmojiLibraryFailed> =>
			Effect.tryPromise({
				try: operation,
				catch: (cause) => new EmojiLibraryFailed(cause),
			});
		const validateGif = (bytes: Uint8Array) =>
			Effect.try({
				try: () => decodeGif(bytes),
				catch: () =>
					new EmojiInvalid(
						"Choose a valid GIF, at most 8 MiB and 1024 × 1024 pixels.",
					),
			});
		const snapshot = Effect.fn("EmojiDesktop.snapshot")(function* (
			notice = "",
			apps: readonly { name: string; path: string; identifier: string }[] = [],
		): Effect.fn.Return<EmojiReply, EmojiLibraryFailed> {
			const store = yield* repository.read();
			return { _tag: "ready", store, assets: {}, notice, apps };
		});
		const addGif = Effect.fn("EmojiDesktop.addGif")(function* (
			bytes: Uint8Array,
			name: string,
			renderedBytes: Uint8Array = bytes,
			caption: EmojiCaption = defaultCaption,
		): Effect.fn.Return<void, EmojiInvalid | EmojiLibraryFailed> {
			if (name.length > 30 || weightedLength(caption.text) > 50)
				return yield* new EmojiInvalid(
					"Use a name of at most 30 characters and a caption of at most 50 weighted units.",
				);
			const original = yield* validateGif(bytes);
			const rendered = yield* validateGif(renderedBytes);
			if (!sameAnimation(original, rendered))
				return yield* new EmojiInvalid(
					"Caption rendering changed the animation timing or size.",
				);
			const hash = yield* io(() => port.files.put(bytes));
			const item: EmojiItem = {
				id: randomUUID(),
				name: name.slice(0, 30) || "Emoji",
				original: hash,
				rendered: yield* io(() => port.files.put(renderedBytes)),
				caption,
			};
			yield* repository.transact((state) =>
				Effect.succeed({
					...state,
					revision: state.revision + 1,
					items: [...state.items, item],
					drafts: [item.id, ...state.drafts],
				}),
			);
		});
		const request = Effect.fn("EmojiDesktop.request")(function* (
			input: EmojiRequest,
		): Effect.fn.Return<EmojiReply, EmojiLibraryFailed | EmojiInvalid> {
			switch (input.type) {
				case "read":
					return yield* snapshot();
				case "command":
					yield* library.command(input.command);
					return yield* snapshot();
				case "generate": {
					const generation = port.generation;
					if (!generation)
						return yield* new EmojiInvalid(
							"Motion generation needs a configured AI provider. Import a GIF or use a static image.",
						);
					const state = yield* repository.read();
					const asset = state.staticAssets.find(
						(a) => a.hash === input.assetId,
					);
					if (!asset || !input.prompt.trim() || input.prompt.length > 180)
						return yield* new EmojiInvalid(
							"Select an image and describe the motion in at most 180 characters.",
						);
					const bytes = yield* io(() => port.files.get(asset.hash));
					const generated = yield* io(() =>
						generation.generate({
							bytes,
							format: asset.format,
							prompt: input.prompt,
						}),
					);
					yield* validateGif(generated);
					const name = input.name?.trim() || asset.name.slice(0, 30);
					const caption = input.caption ?? defaultCaption;
					if (name.length > 30 || weightedLength(caption.text) > 50)
						return yield* new EmojiInvalid(
							"Use a name of at most 30 characters and a caption of at most 50 weighted units.",
						);
					return {
						_tag: "generated",
						base64: Buffer.from(generated).toString("base64"),
						name,
						caption,
					};
				}
				case "import-static":
				case "import-gif": {
					const result = yield* io(() =>
						dialog.showOpenDialog(port.management(), {
							properties: ["openFile", "multiSelections"],
							filters: [
								{
									name:
										input.type === "import-static" ? "Images" : "Animated GIF",
									extensions:
										input.type === "import-static"
											? ["png", "jpg", "jpeg"]
											: ["gif"],
								},
							],
						}),
					);
					if (result.canceled) return yield* snapshot();
					let added = 0;
					let duplicates = 0;
					return yield* Effect.gen(function* () {
						for (const path of result.filePaths) {
							const size = yield* io(() => stat(path));
							if (size.size > 8 * 1024 * 1024)
								return yield* new EmojiInvalid("Choose an image under 8 MiB.");
							const bytes = yield* io(() => readFile(path));
							if (input.type === "import-gif") {
								yield* addGif(
									bytes,
									basename(path)
										.replace(/\.[^.]+$/, "")
										.slice(0, 30),
								);
								added++;
							} else {
								const decoded = yield* imageDecoder
									.decode(bytes)
									.pipe(
										Effect.catchTag("MediaUnreadable", () =>
											Effect.fail(
												new EmojiInvalid("Choose a valid PNG or JPG image."),
											),
										),
									);
								const hash = yield* io(() => port.files.put(bytes));
								const state = yield* repository.read();
								if (state.staticAssets.some((asset) => asset.hash === hash)) {
									duplicates++;
									continue;
								}
								yield* repository.transact((state) =>
									Effect.succeed({
										...state,
										revision: state.revision + 1,
										staticAssets: [
											...state.staticAssets,
											{ hash, name: basename(path), format: decoded.format },
										],
									}),
								);
								added++;
							}
						}
						return yield* snapshot(
							`${added} imported${duplicates ? `, ${duplicates} duplicate images skipped` : ""}.`,
						);
					}).pipe(
						Effect.catchAll((error) =>
							added > 0
								? snapshot(
										`${added} imported before an error. Remaining files were not imported. ${error._tag === "EmojiInvalid" ? error.reason : "Could not read or save the next image."}`,
									)
								: Effect.fail(error),
						),
					);
				}
				case "create-result": {
					if (
						input.base64.length > 12 * 1024 * 1024 ||
						(input.renderedBase64?.length ?? 0) > 12 * 1024 * 1024
					)
						return yield* new EmojiInvalid("GIF exceeds 8 MiB.");
					yield* addGif(
						Buffer.from(input.base64, "base64"),
						input.name,
						Buffer.from(input.renderedBase64 ?? input.base64, "base64"),
						input.caption ?? defaultCaption,
					);
					return yield* snapshot("Generated. Select to add to the pack.");
				}
				case "caption": {
					if (
						input.base64.length > 12 * 1024 * 1024 ||
						weightedLength(input.caption.text) > 50
					)
						return yield* new EmojiInvalid(
							"Caption exceeds 50 weighted units or GIF is too large.",
						);
					const state = yield* repository.read();
					const item = state.items.find((item) => item.id === input.id);
					if (!item) return yield* new EmojiInvalid("Emoji not found.");
					const bytes = Buffer.from(input.base64, "base64");
					const rendered = yield* validateGif(bytes);
					const original = yield* io(() => port.files.get(item.original)).pipe(
						Effect.flatMap(validateGif),
					);
					if (
						rendered.width !== original.width ||
						rendered.height !== original.height ||
						rendered.loopCount !== original.loopCount ||
						rendered.frames.length !== original.frames.length ||
						rendered.frames.some(
							(frame, i) => frame.delayMs !== original.frames[i]?.delayMs,
						)
					)
						return yield* new EmojiInvalid(
							"Caption rendering changed the animation timing or size.",
						);
					const hash = yield* io(() => port.files.put(bytes));
					yield* repository.transact((state) =>
						Effect.succeed({
							...state,
							revision: state.revision + 1,
							items: state.items.map((item) =>
								item.id === input.id
									? { ...item, rendered: hash, caption: input.caption }
									: item,
							),
						}),
					);
					return yield* snapshot("Caption saved.");
				}
				case "asset": {
					const state = yield* repository.read();
					const bytes = yield* io(() => port.files.get(input.hash));
					const format =
						state.staticAssets.find((asset) => asset.hash === input.hash)
							?.format ?? "image/gif";
					return {
						_tag: "ready",
						store: state,
						assets: {
							[input.hash]: `data:${format};base64,${bytes.toString("base64")}`,
						},
						notice: "",
						apps: [],
					};
				}
				case "installed-apps":
					return yield* snapshot(
						"",
						yield* io(() =>
							loadInstalledProfileApps(
								process.platform === "darwin"
									? "darwin"
									: process.platform === "win32"
										? "win32"
										: "linux",
							),
						),
					);
				case "pick-app": {
					const selected = yield* io(() =>
						dialog.showOpenDialog(port.management(), {
							properties: ["openFile"],
							filters: [
								{
									name: "Application",
									extensions: process.platform === "darwin" ? ["app"] : ["exe"],
								},
							],
						}),
					);
					const path = selected.filePaths[0];
					if (!path) return yield* snapshot();
					if (
						!(process.platform === "darwin"
							? path.endsWith(".app")
							: path.toLowerCase().endsWith(".exe"))
					)
						return yield* new EmojiInvalid("Choose an application.");
					return yield* snapshot("", [
						{
							name: basename(path).replace(/\.(app|exe)$/i, ""),
							path,
							identifier: "",
						},
					]);
				}
				case "place": {
					const state = yield* repository.read();
					yield* Effect.tryPromise({
						try: () =>
							port.place(input.id, state, (profileId) =>
								Effect.runPromise(
									repository.transact((current) =>
										current.packages.some((pack) => pack.id === input.id)
											? Effect.succeed({
													...current,
													revision: current.revision + 1,
													packages: current.packages.map((pack) =>
														pack.id === input.id
															? { ...pack, profileId }
															: pack,
													),
												})
											: Effect.fail(new EmojiInvalid("Package not found.")),
									),
								).then(() => undefined),
							),
						catch: (cause) => {
							const error = Runtime.isFiberFailure(cause)
								? Option.getOrElse(
										Cause.failureOption(cause[Runtime.FiberFailureCauseId]),
										() => cause,
									)
								: cause;
							return error instanceof EmojiInvalid
								? error
								: new EmojiLibraryFailed(cause);
						},
					});
					return yield* snapshot("Added to Quake main settings screen");
				}
				case "export": {
					const state = yield* repository.read();
					const pack = state.packages.find((p) => p.id === input.id);
					if (!pack) return yield* new EmojiInvalid("Package not found.");
					const picked = yield* io(() =>
						dialog.showOpenDialog(port.management(), {
							properties: ["openDirectory", "createDirectory"],
						}),
					);
					const directory = picked.filePaths[0];
					if (!directory) return yield* snapshot();
					const destination = join(
						directory,
						`Emoji-${pack.name.replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 40) || "Pack"}-${randomUUID()}`,
					);
					yield* io(async () => {
						await mkdir(destination);
					});
					yield* Effect.gen(function* () {
						for (const [index, id] of pack.emojiIds.entries()) {
							const item = state.items.find((item) => item.id === id);
							if (item) {
								const bytes = yield* io(() => port.files.get(item.rendered));
								const name =
									item.name.replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 60) ||
									"Emoji";
								yield* io(() =>
									writeFile(
										join(
											destination,
											`${String(index + 1).padStart(2, "0")}-${name}.gif`,
										),
										bytes,
										{ flag: "wx" },
									),
								);
							}
						}
					}).pipe(
						Effect.onError(() =>
							io(() => rm(destination, { recursive: true, force: true })).pipe(
								Effect.ignore,
							),
						),
					);
					return yield* snapshot("Emoji pack exported.");
				}
			}
		});
		return {
			request: (input: EmojiRequest) =>
				request(input).pipe(lock.withPermits(1), Effect.uninterruptible),
			snapshot,
		};
	},
);

function sameAnimation(
	original: ReturnType<typeof decodeGif>,
	rendered: ReturnType<typeof decodeGif>,
): boolean {
	return (
		original.width === rendered.width &&
		original.height === rendered.height &&
		original.loopCount === rendered.loopCount &&
		original.frames.length === rendered.frames.length &&
		rendered.frames.every(
			(frame, index) => frame.delayMs === original.frames[index]?.delayMs,
		)
	);
}

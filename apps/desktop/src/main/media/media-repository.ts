import { basename } from "node:path";
import { Effect, Option, Schema } from "effect";
import {
	type DesktopClockTile,
	DisplayIdentity,
	defaultClockTile,
	InvalidWallpaper,
	intervalMillis,
	type MediaPersistenceFailed,
	MediaUnreadable,
	SavedWallpaper,
	type WallpaperSettings,
} from "../../shared/display";
import { factoryMedia, factoryWallpaper } from "./factory-wallpaper";
import { normalizeLocalSelection } from "./image-decoder";
import { type DecodedMedia, MediaDecoder } from "./media-decoder";
import { MediaFiles } from "./media-files";

export type MediaRepositoryError =
	| InvalidWallpaper
	| MediaUnreadable
	| MediaPersistenceFailed;
export class MediaRepository extends Effect.Service<MediaRepository>()(
	"MediaRepository",
	{
		accessors: true,
		dependencies: [MediaFiles.Default, MediaDecoder.Default],
		effect: Effect.gen(function* () {
			const files = yield* MediaFiles;
			const decoder = yield* MediaDecoder;
			const lock = yield* Effect.makeSemaphore(1);
			const drafts = new Map<string, Map<string, Set<string>>>();
			const stagedReferences = (serial: string) =>
				[...(drafts.get(serial)?.values() ?? [])].flatMap((refs) => [...refs]);
			const discard = Effect.fn("MediaRepository.discard")(
				(
					serial: string,
					draftId: string,
				): Effect.Effect<void, MediaRepositoryError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							serial = serial.replace(/^ws_/, "");
							if (!Schema.is(DisplayIdentity)(serial))
								return yield* new InvalidWallpaper(undefined);
							drafts.get(serial)?.delete(draftId);
							if (!drafts.get(serial)?.size) drafts.delete(serial);
							yield* files.collectAssets(serial, stagedReferences(serial));
						}),
					),
			);
			const validate = Effect.fn("MediaRepository.validate")(
				(input: unknown): Effect.Effect<SavedWallpaper, InvalidWallpaper> =>
					Schema.decodeUnknown(SavedWallpaper)(input).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(new InvalidWallpaper(cause)),
						),
					),
			);
			const load = Effect.fn("MediaRepository.load")(
				(
					serial: string,
				): Effect.Effect<
					{ saved: SavedWallpaper; recovered: boolean },
					InvalidWallpaper | MediaPersistenceFailed
				> =>
					Effect.gen(function* () {
						serial = serial.replace(/^ws_/, "");
						if (!Schema.is(DisplayIdentity)(serial))
							return yield* new InvalidWallpaper(undefined);
						const current = yield* files
							.readSettings(serial)
							.pipe(Effect.either);
						if (current._tag === "Right" && Option.isSome(current.right))
							return { saved: current.right.value, recovered: false };
						const backup = yield* files.readSettings(serial, true);
						if (Option.isSome(backup))
							return { saved: backup.value, recovered: true };
						if (current._tag === "Left") return yield* current.left;
						return {
							saved: {
								version: 1,
								serial,
								revision: 0,
								settings: factoryWallpaper,
								clock: defaultClockTile,
							},
							recovered: false,
						};
					}),
			);
			const resolve = Effect.fn("MediaRepository.resolve")(
				(
					saved: SavedWallpaper,
					index = 0,
				): Effect.Effect<Option.Option<DecodedMedia>, MediaUnreadable> =>
					Effect.gen(function* () {
						const media = saved.settings.displayMediaList[index];
						if (!media) return Option.none();
						const bundled = factoryMedia(media.filePath);
						if (bundled) {
							if (media.type !== "video" || media.format !== "video/webm")
								return yield* new MediaUnreadable(undefined);
							return Option.some({
								format: "video/webm" as const,
								width: 960,
								height: 240,
								durationMs: 5000,
								dataUrl: `data:video/webm;base64,${bundled.toString("base64")}`,
							});
						}
						const bytes = yield* files
							.readAsset(saved.serial, media.filePath)
							.pipe(
								Effect.catchTag("MediaUnreadable", (error) =>
									files.readSettings(`ws_${saved.serial}`).pipe(
										Effect.mapError((cause) => new MediaUnreadable(cause)),
										Effect.flatMap((legacy) =>
											Option.isSome(legacy) &&
											legacy.value.settings.displayMediaList.some(
												(item) => item.filePath === media.filePath,
											)
												? files.readAsset(`ws_${saved.serial}`, media.filePath)
												: Effect.fail(error),
										),
									),
								),
							);
						const decoded = yield* decoder.decode(bytes);
						if (decoded.format !== media.format)
							return yield* new MediaUnreadable(undefined);
						return Option.some(decoded);
					}),
			);
			const saveUnlocked = Effect.fn("MediaRepository.saveUnlocked")(
				(
					serial: string,
					revision: number,
					settings: WallpaperSettings,
					clock: DesktopClockTile,
				): Effect.Effect<SavedWallpaper, MediaRepositoryError> =>
					Effect.gen(function* () {
						serial = serial.replace(/^ws_/, "");
						const { saved: previous } = yield* load(serial);
						if (previous.revision !== revision)
							return yield* new InvalidWallpaper(undefined);
						const next = yield* validate({
							...previous,
							settings,
							clock,
							revision: revision + 1,
						});

						// Decode newly introduced assets before committing. Reordering never probes removed files.
						for (const [
							index,
							media,
						] of next.settings.displayMediaList.entries())
							if (
								!previous.settings.displayMediaList.some(
									(item) => item.filePath === media.filePath,
								)
							)
								yield* resolve(next, index);
						yield* files.writeSettings(previous, next);
						// Cleanup cannot turn an already committed save into a failed request.
						yield* files.collectAssets(serial, stagedReferences(serial)).pipe(
							Effect.catchTags({
								InvalidWallpaper: () =>
									Effect.logWarning(
										"Wallpaper asset collection skipped: invalid settings",
									),
								MediaPersistenceFailed: () =>
									Effect.logWarning(
										"Wallpaper asset collection deferred: storage unavailable",
									),
							}),
						);
						return next;
					}).pipe(Effect.uninterruptible),
			);
			const save = Effect.fn("MediaRepository.save")(
				(
					serial: string,
					revision: number,
					settings: WallpaperSettings,
					clock: DesktopClockTile,
				): Effect.Effect<SavedWallpaper, MediaRepositoryError> =>
					lock.withPermits(1)(saveUnlocked(serial, revision, settings, clock)),
			);
			const importLocal = Effect.fn("MediaRepository.importLocal")(
				(
					serial: string,
					revision: number,
					selection: string,
					append = false,
					prepend = false,
					persist = true,
					draftId = "legacy",
				): Effect.Effect<
					{ saved: SavedWallpaper; normalizedFileUrl: boolean },
					MediaRepositoryError
				> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							serial = serial.replace(/^ws_/, "");
							const { saved: previous } = yield* load(serial);
							if (previous.revision !== revision)
								return yield* new InvalidWallpaper(undefined);
							const { path, normalizedFileUrl } =
								yield* normalizeLocalSelection(selection);
							const bytes = yield* files.readLocal(path);
							const decoded = yield* decoder.decode(bytes);
							const reference = yield* files.storeAsset(serial, bytes);
							if (!persist) {
								let sessions = drafts.get(serial);
								if (!sessions) {
									sessions = new Map();
									drafts.set(serial, sessions);
								}
								let refs = sessions.get(draftId);
								if (!refs) {
									refs = new Set();
									sessions.set(draftId, refs);
								}
								refs.add(reference);
							}
							const media = {
								name: basename(path),
								filePath: reference,
								...(decoded.format === "image/png" ||
								decoded.format === "image/jpeg" ||
								decoded.format === "image/gif"
									? {
											type: "image" as const,
											format: decoded.format,
											duration: intervalMillis(
												previous.settings.gapInterval,
												previous.settings.gapIntervalUnit,
											),
										}
									: {
											type: "video" as const,
											format: decoded.format,
											duration:
												"durationMs" in decoded ? decoded.durationMs : 2000,
										}),
							};
							const settings: WallpaperSettings = {
								...previous.settings,
								displayMediaList: [
									...(prepend ? [media] : []),
									...(append ? previous.settings.displayMediaList : []),
									...(prepend ? [] : [media]),
								],
							};
							if (
								append &&
								previous.settings.displayMediaList.some(
									(media) => media.filePath === reference,
								)
							)
								return { saved: previous, normalizedFileUrl };
							const saved = persist
								? yield* saveUnlocked(
										serial,
										revision,
										settings,
										previous.clock,
									)
								: yield* validate({ ...previous, settings });
							return { saved, normalizedFileUrl };
						}),
					),
			);
			const restore = Effect.fn("MediaRepository.restore")(
				(
					serial: string,
					revision: number,
				): Effect.Effect<SavedWallpaper, MediaRepositoryError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							serial = serial.replace(/^ws_/, "");
							const backup = yield* files.readSettings(serial, true);
							if (Option.isNone(backup))
								return yield* new InvalidWallpaper(undefined);
							return yield* saveUnlocked(
								serial,
								revision,
								backup.value.settings,
								backup.value.clock,
							);
						}),
					),
			);
			return {
				discard,
				load,
				resolve,
				save,
				importLocal,
				restore,
			};
		}),
	},
) {}

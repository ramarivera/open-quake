import { basename } from "node:path";
import { Effect, Option, Schema } from "effect";
import {
	type DesktopClockTile,
	DisplayIdentity,
	defaultClockTile,
	defaultWallpaper,
	InvalidWallpaper,
	intervalMillis,
	type MediaPersistenceFailed,
	MediaUnreadable,
	SavedWallpaper,
	type WallpaperSettings,
} from "../../renderer/src/wallpaper/display";
import { ImageDecoder, normalizeLocalSelection } from "./image-decoder";
import { MediaFiles } from "./media-files";

export type MediaRepositoryError =
	| InvalidWallpaper
	| MediaUnreadable
	| MediaPersistenceFailed;
export class MediaRepository extends Effect.Service<MediaRepository>()(
	"MediaRepository",
	{
		accessors: true,
		dependencies: [MediaFiles.Default, ImageDecoder.Default],
		effect: Effect.gen(function* () {
			const files = yield* MediaFiles;
			const decoder = yield* ImageDecoder;
			const lock = yield* Effect.makeSemaphore(1);
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
								settings: defaultWallpaper,
								clock: defaultClockTile,
							},
							recovered: false,
						};
					}),
			);
			const resolve = Effect.fn("MediaRepository.resolve")(
				(
					saved: SavedWallpaper,
				): Effect.Effect<
					Option.Option<import("./image-decoder").DecodedImage>,
					MediaUnreadable
				> =>
					Effect.gen(function* () {
						const media = saved.settings.displayMediaList[0];
						if (!media) return Option.none();
						const bytes = yield* files.readAsset(media.filePath);
						const decoded = yield* decoder.decode(bytes);
						if (decoded.format !== media.format)
							return yield* new MediaUnreadable(undefined);
						return Option.some(decoded);
					}),
			);
			const save = Effect.fn("MediaRepository.save")(
				(
					serial: string,
					revision: number,
					settings: WallpaperSettings,
					clock: DesktopClockTile,
				): Effect.Effect<SavedWallpaper, MediaRepositoryError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const { saved: previous } = yield* load(serial);
							if (previous.revision !== revision)
								return yield* new InvalidWallpaper(undefined);
							const next = yield* validate({
								...previous,
								settings,
								clock,
								revision: revision + 1,
							});
							// No unreadable new selection may replace the last readable revision.
							if (
								next.settings.displayMediaList[0]?.filePath !==
								previous.settings.displayMediaList[0]?.filePath
							)
								yield* resolve(next);
							yield* files.writeSettings(previous, next);
							return next;
						}),
					),
			);
			const importLocal = Effect.fn("MediaRepository.importLocal")(
				(
					serial: string,
					revision: number,
					selection: string,
				): Effect.Effect<
					{ saved: SavedWallpaper; normalizedFileUrl: boolean },
					MediaRepositoryError
				> =>
					Effect.gen(function* () {
						const { path, normalizedFileUrl } =
							yield* normalizeLocalSelection(selection);
						const bytes = yield* files.readLocal(path);
						const decoded = yield* decoder.decode(bytes);
						const reference = yield* files.storeAsset(bytes);
						const { saved: previous } = yield* load(serial);
						const settings = {
							...previous.settings,
							displayMediaList: [
								{
									name: basename(path),
									type: "image" as const,
									filePath: reference,
									format: decoded.format,
									duration: intervalMillis(
										previous.settings.gapInterval,
										previous.settings.gapIntervalUnit,
									),
								},
							],
						};
						const saved = yield* save(
							serial,
							revision,
							settings,
							previous.clock,
						);
						return { saved, normalizedFileUrl };
					}),
			);
			const restore = Effect.fn("MediaRepository.restore")(
				(
					serial: string,
					revision: number,
				): Effect.Effect<SavedWallpaper, MediaRepositoryError> =>
					Effect.gen(function* () {
						const backup = yield* files.readSettings(serial, true);
						if (Option.isNone(backup))
							return yield* new InvalidWallpaper(undefined);
						return yield* save(
							serial,
							revision,
							backup.value.settings,
							backup.value.clock,
						);
					}),
			);
			return {
				load,
				resolve,
				save,
				importLocal,
				restore,
			};
		}),
	},
) {}

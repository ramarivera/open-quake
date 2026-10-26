import { Effect, Option, Ref, Schema, Stream } from "effect";
import {
	clockSnapshot,
	defaultClockTile,
	displayClock,
	InvalidWallpaper,
	nextWallpaperIndex,
	reorderWallpaper,
} from "../../shared/display";
import {
	WallpaperCommand,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import { MediaRepository, type MediaRepositoryError } from "./media-repository";

export interface MediaDesktopEdge {
	readonly chooseImage: Effect.Effect<
		Option.Option<string>,
		MediaRepositoryError
	>;
	readonly publish: (snapshot: WallpaperSnapshot) => Effect.Effect<void>;
	readonly publishClock: (
		clock: WallpaperSnapshot["clock"],
	) => Effect.Effect<void>;
}

export interface MediaController {
	readonly request: (
		input: unknown,
	) => Effect.Effect<WallpaperSnapshot, MediaRepositoryError>;
	readonly ticks: Effect.Effect<void>;
	readonly selectionSerial: Effect.Effect<string>;
}

export const makeMediaController = Effect.fn("MediaController.make")(
	(
		edge: MediaDesktopEdge,
	): Effect.Effect<MediaController, never, MediaRepository> =>
		Effect.gen(function* () {
			const repository = yield* MediaRepository;
			const activeSerial = yield* Ref.make("desktop-preview");
			const clock = yield* Ref.make(
				clockSnapshot(
					yield* Effect.clockWith((source) => source.currentTimeMillis),
				),
			);
			const semaphore = yield* Effect.makeSemaphore(1);
			let activeIndex = 0;
			let elapsed = 0;
			let previousTick = yield* Effect.clockWith(
				(source) => source.currentTimeMillis,
			);
			let playlistKey = "";
			const snapshot = Effect.fn("MediaController.snapshot")(
				(
					serial: string,
					normalizedFileUrl = false,
				): Effect.Effect<WallpaperSnapshot, MediaRepositoryError> =>
					Effect.gen(function* () {
						const { saved, recovered } = yield* repository.load(serial);
						const key = JSON.stringify([
							serial,
							saved.settings.displayMediaList.map((media) => [
								media.filePath,
								media.duration,
							]),
						]);
						if (key !== playlistKey) {
							playlistKey = key;
							activeIndex = 0;
							elapsed = 0;
							previousTick = yield* Effect.clockWith(
								(source) => source.currentTimeMillis,
							);
						}
						const asset = yield* repository.resolve(saved, activeIndex).pipe(
							Effect.map(
								Option.match({
									onNone: () => ({ _tag: "empty" as const }),
									onSome: (image) => ({ _tag: "ready" as const, ...image }),
								}),
							),
							Effect.catchTag("MediaUnreadable", () =>
								Effect.succeed({ _tag: "unreadable" as const }),
							),
						);
						return {
							saved,
							activeIndex,
							asset,
							recovered,
							normalizedFileUrl,
							deviceDelivery: "unverified",
							clock: yield* Ref.get(clock),
						};
					}),
			);
			const request = Effect.fn("MediaController.request")(
				(
					input: unknown,
				): Effect.Effect<WallpaperSnapshot, MediaRepositoryError> =>
					semaphore.withPermits(1)(
						Effect.gen(function* () {
							const command = yield* Schema.decodeUnknown(WallpaperCommand)(
								input,
							).pipe(
								Effect.catchTag("ParseError", (cause) =>
									Effect.fail(new InvalidWallpaper(cause)),
								),
							);
							const serial =
								command._tag === "read"
									? yield* Ref.get(activeSerial)
									: command.serial;
							if (
								command._tag !== "select" &&
								command._tag !== "read" &&
								serial !== (yield* Ref.get(activeSerial))
							)
								return yield* new InvalidWallpaper(undefined);
							let normalizedFileUrl = false;
							if (command._tag === "import") {
								const path = yield* edge.chooseImage;
								if (Option.isSome(path))
									normalizedFileUrl = (yield* repository.importLocal(
										serial,
										command.revision,
										path.value,
										command.append,
									)).normalizedFileUrl;
							} else if (command._tag === "restore")
								yield* repository.restore(serial, command.revision);
							else if (
								command._tag === "configure" ||
								command._tag === "clear" ||
								command._tag === "reorder" ||
								command._tag === "sound" ||
								command._tag === "remove"
							) {
								const { saved } = yield* repository.load(serial);
								const list = saved.settings.displayMediaList;
								if (
									(command._tag === "reorder" &&
										(command.from >= list.length ||
											command.to >= list.length)) ||
									(command._tag === "remove" && command.index >= list.length)
								)
									return yield* new InvalidWallpaper(undefined);
								yield* repository.save(
									serial,
									command.revision,
									command._tag === "clear"
										? { ...saved.settings, displayMediaList: [] }
										: command._tag === "sound"
											? { ...saved.settings, enableSound: command.enableSound }
											: command._tag === "reorder"
												? {
														...saved.settings,
														displayMediaList: reorderWallpaper(
															list,
															command.from,
															command.to,
														),
													}
												: command._tag === "remove"
													? {
															...saved.settings,
															displayMediaList: list.filter(
																(_, index) => index !== command.index,
															),
														}
													: { ...saved.settings, bgFillMode: command.fillMode },
									command._tag === "configure"
										? {
												...defaultClockTile,
												actions: [
													{ type: "hourFormat", value: command.hourFormat },
												],
											}
										: saved.clock,
								);
							}
							const next = yield* snapshot(serial, normalizedFileUrl);
							if (command._tag === "select")
								yield* Ref.set(activeSerial, serial);
							yield* edge.publish(next);
							return next;
						}),
					),
			);
			const ticks = displayClock.pipe(
				Stream.runForEach((next) =>
					semaphore
						.withPermits(1)(
							Effect.gen(function* () {
								const now = yield* Effect.clockWith(
									(source) => source.currentTimeMillis,
								);
								const delta = Math.max(0, now - previousTick);
								previousTick = now;
								yield* Ref.set(clock, next);
								yield* edge.publishClock(next);
								const serial = yield* Ref.get(activeSerial);
								const { saved } = yield* repository.load(serial);
								if (saved.settings.displayMediaList.length <= 1) return;
								elapsed += delta;
								if (
									elapsed <
									(saved.settings.displayMediaList[activeIndex]?.duration ??
										5000)
								)
									return;
								elapsed = 0;
								activeIndex = nextWallpaperIndex(
									activeIndex,
									saved.settings.displayMediaList.length,
									saved.settings.playMode,
								);
								yield* edge.publish(yield* snapshot(serial));
							}),
						)
						.pipe(
							Effect.catchTags({
								InvalidWallpaper: () => Effect.void,
								MediaUnreadable: () => Effect.void,
								MediaPersistenceFailed: () => Effect.void,
							}),
						),
				),
			);
			return { request, ticks, selectionSerial: Ref.get(activeSerial) };
		}),
);

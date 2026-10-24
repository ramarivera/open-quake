import { Effect, Option, Ref, Schema, Stream } from "effect";
import {
	clockSnapshot,
	defaultClockTile,
	displayClock,
	InvalidWallpaper,
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
			const snapshot = Effect.fn("MediaController.snapshot")(
				(
					serial: string,
					normalizedFileUrl = false,
				): Effect.Effect<WallpaperSnapshot, MediaRepositoryError> =>
					Effect.gen(function* () {
						const { saved, recovered } = yield* repository.load(serial);
						const asset = yield* repository.resolve(saved).pipe(
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
									)).normalizedFileUrl;
							} else if (command._tag === "restore")
								yield* repository.restore(serial, command.revision);
							else if (
								command._tag === "configure" ||
								command._tag === "clear"
							) {
								const { saved } = yield* repository.load(serial);
								yield* repository.save(
									serial,
									command.revision,
									command._tag === "clear"
										? { ...saved.settings, displayMediaList: [] }
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
					Ref.set(clock, next).pipe(Effect.zipRight(edge.publishClock(next))),
				),
			);
			return { request, ticks, selectionSerial: Ref.get(activeSerial) };
		}),
);

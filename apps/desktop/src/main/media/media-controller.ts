import { Effect, Option, Queue, Ref, Schema, Stream } from "effect";
import {
	clockSnapshot,
	defaultClockTile,
	displayClock,
	InvalidWallpaper,
	intervalMillis,
	nextWallpaperIndex,
	reorderWallpaper,
} from "../../shared/display";
import {
	WallpaperCommand,
	type WallpaperSnapshot,
} from "../../shared/wallpaper-contracts";
import { factoryWallpaper } from "./factory-wallpaper";
import { MediaRepository, type MediaRepositoryError } from "./media-repository";

export interface MediaDesktopEdge {
	readonly chooseImage: Effect.Effect<
		Option.Option<string>,
		MediaRepositoryError
	>;
	readonly chooseImages?: Effect.Effect<
		readonly string[],
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
			let playbackId = 0;
			let playbackStartedAt = 0;
			let deadline = 0;
			let preloadIndex: number | undefined;
			const failed = new Set<number>();
			const playlistChanged = yield* Queue.sliding<void>(1);
			let playlistKey = "";
			const synchronizePlaylist = Effect.fn(
				"MediaController.synchronizePlaylist",
			)(function* (serial: string, saved: WallpaperSnapshot["saved"]) {
				const key = JSON.stringify([
					serial,
					saved.settings.isTransparent,
					saved.settings.displayMediaList.map((media) => [
						media.filePath,
						media.duration,
					]),
				]);
				if (key !== playlistKey) {
					playlistKey = key;
					playbackId++;
					preloadIndex = undefined;
					failed.clear();
					activeIndex =
						saved.settings.playMode === "random"
							? Math.floor(
									Math.random() * saved.settings.displayMediaList.length,
								) || 0
							: 0;
					playbackStartedAt = yield* Effect.clockWith(
						(source) => source.currentTimeMillis,
					);
					deadline =
						playbackStartedAt +
						(saved.settings.displayMediaList[activeIndex]?.duration ?? 5000);
					yield* Queue.offer(playlistChanged, undefined);
				}
			});
			const nextPlayable = (saved: WallpaperSnapshot["saved"]) => {
				const candidates = saved.settings.displayMediaList
					.map((_, index) => index)
					.filter((index) => !failed.has(index));
				if (!candidates.includes(activeIndex))
					return (
						candidates.find((index) => index > activeIndex) ??
						candidates[0] ??
						activeIndex
					);
				return (
					candidates[
						nextWallpaperIndex(
							Math.max(0, candidates.indexOf(activeIndex)),
							candidates.length,
							saved.settings.playMode,
						)
					] ?? activeIndex
				);
			};
			const snapshot = Effect.fn("MediaController.snapshot")(
				(
					serial: string,
					normalizedFileUrl = false,
				): Effect.Effect<
					Omit<WallpaperSnapshot, "asset">,
					MediaRepositoryError
				> =>
					Effect.gen(function* () {
						const { saved, recovered } = yield* repository.load(serial);
						yield* synchronizePlaylist(serial, saved);

						return {
							saved,
							activeIndex,
							playbackId,
							playbackStartedAt,
							recovered,
							normalizedFileUrl,
							deviceDelivery: "unverified",
							...(preloadIndex === undefined
								? {}
								: {
										preload: {
											index: preloadIndex,
											asset: { _tag: "empty" as const },
										},
									}),
							clock: yield* Ref.get(clock),
						};
					}),
			);
			const publishSnapshot = Effect.fn("MediaController.publishSnapshot")(
				(
					initial: Omit<WallpaperSnapshot, "asset">,
				): Effect.Effect<WallpaperSnapshot, MediaRepositoryError> =>
					Effect.gen(function* () {
						let base = initial;
						while (true) {
							const asset =
								failed.size >= base.saved.settings.displayMediaList.length &&
								failed.size > 0
									? { _tag: "unreadable" as const }
									: base.saved.settings.isTransparent
										? { _tag: "empty" as const }
										: yield* repository
												.resolve(base.saved, base.activeIndex ?? 0)
												.pipe(
													Effect.map(
														Option.match({
															onNone: () => ({ _tag: "empty" as const }),
															onSome: (media) => ({
																_tag: "ready" as const,
																...media,
															}),
														}),
													),
													Effect.catchTag("MediaUnreadable", () =>
														Effect.succeed({ _tag: "unreadable" as const }),
													),
												);
							const preload =
								base.preload && !base.saved.settings.isTransparent
									? yield* repository
											.resolve(base.saved, base.preload.index)
											.pipe(
												Effect.map(
													Option.match({
														onNone: () => ({ _tag: "empty" as const }),
														onSome: (media) => ({
															_tag: "ready" as const,
															...media,
														}),
													}),
												),
												Effect.catchTag("MediaUnreadable", () =>
													Effect.succeed({ _tag: "unreadable" as const }),
												),
											)
									: undefined;
							const next: WallpaperSnapshot = {
								...base,
								asset,
								...(base.preload && preload
									? { preload: { index: base.preload.index, asset: preload } }
									: {}),
							};
							const published = yield* semaphore.withPermits(1)(
								Effect.gen(function* () {
									const serial = yield* Ref.get(activeSerial);
									const { saved } = yield* repository.load(serial);
									if (
										serial !== base.saved.serial ||
										saved.revision !== base.saved.revision ||
										playbackId !== base.playbackId ||
										activeIndex !== base.activeIndex
									)
										return false;

									if (
										asset._tag === "unreadable" &&
										!saved.settings.isTransparent &&
										!failed.has(activeIndex)
									) {
										failed.add(activeIndex);
										preloadIndex = undefined;
										yield* Queue.offer(playlistChanged, undefined);
										if (failed.size < saved.settings.displayMediaList.length) {
											activeIndex = nextPlayable(saved);
											playbackId++;
											playbackStartedAt = yield* Effect.clockWith(
												(c) => c.currentTimeMillis,
											);
											deadline =
												playbackStartedAt +
												(saved.settings.displayMediaList[activeIndex]
													?.duration ?? 5000);
											return false;
										}
									}
									if (preload?._tag === "unreadable" && base.preload) {
										failed.add(base.preload.index);
										preloadIndex = undefined;
										yield* Queue.offer(playlistChanged, undefined);
									}

									if (
										asset._tag === "ready" &&
										"durationMs" in asset &&
										typeof asset.durationMs === "number"
									) {
										const actualDeadline = playbackStartedAt + asset.durationMs;
										if (deadline !== actualDeadline) {
											deadline = actualDeadline;
											yield* Queue.offer(playlistChanged, undefined);
										}
									}
									yield* edge.publish(next);
									return true;
								}),
							);
							if (published) return next;
							base = yield* semaphore.withPermits(1)(
								Ref.get(activeSerial).pipe(
									Effect.flatMap((serial) => snapshot(serial)),
								),
							);
						}
					}),
			);
			const request = Effect.fn("MediaController.request")(
				(
					input: unknown,
				): Effect.Effect<WallpaperSnapshot, MediaRepositoryError> =>
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
						// Repository transactions serialize revision checks and commits. Native
						// probes stay outside the controller lock, including cold snapshot reads.
						let normalizedFileUrl = false;
						if (command._tag === "failed") {
							const next = yield* semaphore.withPermits(1)(
								Effect.gen(function* () {
									const { saved } = yield* repository.load(serial);
									if (
										saved.revision !== command.revision ||
										command.playbackId !== playbackId ||
										command.index !== activeIndex
									)
										return yield* new InvalidWallpaper(undefined);
									failed.add(activeIndex);
									preloadIndex = undefined;
									if (failed.size < saved.settings.displayMediaList.length) {
										activeIndex = nextPlayable(saved);
										playbackId++;
										playbackStartedAt = yield* Effect.clockWith(
											(c) => c.currentTimeMillis,
										);
										deadline =
											playbackStartedAt +
											(saved.settings.displayMediaList[activeIndex]?.duration ??
												5000);
									}
									yield* Queue.offer(playlistChanged, undefined);
									return yield* snapshot(serial);
								}),
							);
							return yield* publishSnapshot(next);
						}
						if (command._tag === "pick") {
							const paths = edge.chooseImages
								? yield* edge.chooseImages
								: Option.match(yield* edge.chooseImage, {
										onNone: () => [],
										onSome: (path) => [path],
									});
							const base = yield* snapshot(serial);
							if (!paths.length) return { ...base, asset: { _tag: "empty" } };
							let staged = base.saved;
							const items: WallpaperSnapshot["saved"]["settings"]["displayMediaList"][number][] =
								[];
							let normalizedFileUrl = false;
							for (const path of paths.slice(0, 128)) {
								const imported = yield* repository.importLocal(
									serial,
									command.revision,
									path,
									false,
									false,
									false,
								);
								normalizedFileUrl ||= imported.normalizedFileUrl;
								staged = imported.saved;
								const media = staged.settings.displayMediaList[0];
								if (
									media &&
									!items.some((item) => item.filePath === media.filePath)
								)
									items.push(media);
							}
							staged = {
								...staged,
								settings: { ...staged.settings, displayMediaList: items },
							};
							const asset = yield* repository.resolve(staged);
							return {
								...base,
								saved: staged,
								normalizedFileUrl,
								asset: Option.isSome(asset)
									? { _tag: "ready", ...asset.value }
									: { _tag: "empty" },
							};
						}
						if (command._tag === "import" || command._tag === "insert") {
							const path = yield* edge.chooseImage;
							if (Option.isSome(path))
								normalizedFileUrl = (yield* repository.importLocal(
									serial,
									command.revision,
									path.value,
									command._tag === "insert" || command.append,
									command._tag === "insert",
								)).normalizedFileUrl;
						} else if (command._tag === "restore")
							yield* repository.restore(serial, command.revision);
						else if (command._tag === "factory" || command._tag === "save") {
							const { saved } = yield* repository.load(serial);
							const settings =
								command._tag === "factory"
									? factoryWallpaper
									: command.settings;
							const synchronized = {
								...settings,
								displayMediaList: (settings.displayMediaList.length
									? settings.displayMediaList
									: factoryWallpaper.displayMediaList
								).map((item) => ({
									...item,
									duration: intervalMillis(
										settings.gapInterval,
										settings.gapIntervalUnit,
									),
								})),
							};
							if (saved.revision !== command.revision)
								return yield* new InvalidWallpaper(undefined);
							if (
								command._tag === "factory" ||
								JSON.stringify(saved.settings) !== JSON.stringify(synchronized)
							)
								yield* repository.save(
									serial,
									command.revision,
									synchronized,
									saved.clock,
								);
						} else if (
							command._tag === "configure" ||
							command._tag === "clear" ||
							command._tag === "reorder" ||
							command._tag === "sound" ||
							command._tag === "remove"
						) {
							const { saved } = yield* repository.load(serial);
							const list = saved.settings.displayMediaList;
							if (
								saved.revision !== command.revision ||
								(command._tag === "reorder" &&
									(command.from >= list.length || command.to >= list.length)) ||
								(command._tag === "remove" && command.index >= list.length)
							)
								return yield* new InvalidWallpaper(undefined);
							if (command._tag !== "reorder" || command.from !== command.to)
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
						const next = yield* semaphore.withPermits(1)(
							Effect.gen(function* () {
								if (command._tag === "select") {
									const selected = yield* snapshot(serial, normalizedFileUrl);
									yield* Ref.set(activeSerial, serial);
									return selected;
								}
								return yield* snapshot(
									yield* Ref.get(activeSerial),
									normalizedFileUrl,
								);
							}),
						);
						return yield* publishSnapshot(next);
					}),
			);
			const advancePlaylist = semaphore
				.withPermits(1)(
					Effect.gen(function* () {
						const serial = yield* Ref.get(activeSerial);
						const { saved } = yield* repository.load(serial);
						yield* synchronizePlaylist(serial, saved);
						const list = saved.settings.displayMediaList;
						if (
							saved.settings.isTransparent ||
							failed.size >= list.length ||
							list.length <= 1
						)
							return {
								wait: Option.none<number>(),
								next: Option.none<Omit<WallpaperSnapshot, "asset">>(),
							};
						const now = yield* Effect.clockWith(
							(source) => source.currentTimeMillis,
						);
						// Retain the prior deadline even when IO or a suspended host wakes late.
						let next = Option.none<Omit<WallpaperSnapshot, "asset">>();
						if (now >= deadline - 800) {
							activeIndex = preloadIndex ?? nextPlayable(saved);
							preloadIndex = undefined;
							playbackStartedAt = deadline - 800;
							deadline =
								playbackStartedAt + (list[activeIndex]?.duration ?? 5000);
							playbackId++;
							next = Option.some(yield* snapshot(serial));
						} else if (now >= deadline - 1000 && preloadIndex === undefined) {
							preloadIndex = nextPlayable(saved);
							next = Option.some(yield* snapshot(serial));
						}
						return {
							next,
							wait: Option.some(
								Math.max(
									0,
									deadline -
										(preloadIndex === undefined && now < deadline - 1000
											? 1000
											: 800) -
										(yield* Effect.clockWith(
											(source) => source.currentTimeMillis,
										)),
								),
							),
						};
					}),
				)
				.pipe(
					Effect.flatMap(({ next, wait }) =>
						Option.isSome(next)
							? publishSnapshot(next.value).pipe(Effect.as(wait))
							: Effect.succeed(wait),
					),
					Effect.catchTags({
						InvalidWallpaper: () => Effect.succeed(Option.some(1000)),
						MediaUnreadable: () => Effect.succeed(Option.some(1000)),
						MediaPersistenceFailed: () => Effect.succeed(Option.some(1000)),
					}),
				);
			const playlistTicks = Effect.forever(
				advancePlaylist.pipe(
					Effect.flatMap(
						Option.match({
							onNone: () => Queue.take(playlistChanged),
							onSome: (wait) =>
								Effect.raceFirst(
									Effect.sleep(wait),
									Queue.take(playlistChanged),
								),
						}),
					),
				),
			);
			const clockTicks = displayClock.pipe(
				Stream.runForEach((next) =>
					Ref.set(clock, next).pipe(Effect.zipRight(edge.publishClock(next))),
				),
			);
			const ticks = Effect.all([clockTicks, playlistTicks], {
				concurrency: "unbounded",
				discard: true,
			});
			return { request, ticks, selectionSerial: Ref.get(activeSerial) };
		}),
);

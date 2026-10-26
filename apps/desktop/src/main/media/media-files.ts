import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Option, Schema } from "effect";
import {
	AssetReference,
	DESKTOP_RESOURCE_LIMIT,
	InvalidWallpaper,
	MediaPersistenceFailed,
	MediaUnreadable,
	SavedWallpaper,
} from "../../shared/display";

export class MediaRoot extends Context.Tag("MediaRoot")<MediaRoot, string>() {}
const hash = (input: string | Buffer): string =>
	createHash("sha256").update(input).digest("hex");
const absent = (cause: unknown): boolean =>
	typeof cause === "object" &&
	cause !== null &&
	"code" in cause &&
	cause.code === "ENOENT";

export class MediaFiles extends Effect.Service<MediaFiles>()("MediaFiles", {
	accessors: true,
	effect: Effect.gen(function* () {
		const root = yield* MediaRoot;
		const settingsPath = (serial: string, backup: boolean): string =>
			join(root, "settings", `${hash(serial)}${backup ? ".backup" : ""}.json`);
		const readSettings = Effect.fn("MediaFiles.readSettings")(
			(
				serial: string,
				backup = false,
			): Effect.Effect<
				Option.Option<SavedWallpaper>,
				InvalidWallpaper | MediaPersistenceFailed
			> =>
				Effect.tryPromise({
					try: async () => {
						try {
							return await readFile(settingsPath(serial, backup), "utf8");
						} catch (cause) {
							if (!absent(cause) || serial.startsWith("ws_")) throw cause;
							return await readFile(
								settingsPath(`ws_${serial}`, backup),
								"utf8",
							);
						}
					},
					catch: (cause) => new MediaPersistenceFailed(cause),
				}).pipe(
					Effect.map(Option.some),
					Effect.catchTag("MediaPersistenceFailed", (error) =>
						absent(error.originalCause)
							? Effect.succeed(Option.none<string>())
							: Effect.fail(error),
					),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.succeed(Option.none<SavedWallpaper>()),
							onSome: (text) =>
								Effect.try({
									try: () => JSON.parse(text) as unknown,
									catch: (cause) => new InvalidWallpaper(cause),
								}).pipe(
									Effect.flatMap((input) =>
										Schema.decodeUnknown(SavedWallpaper)(input).pipe(
											Effect.catchTag("ParseError", (cause) =>
												Effect.fail(new InvalidWallpaper(cause)),
											),
										),
									),
									Effect.filterOrFail(
										(saved) =>
											saved.serial === serial ||
											saved.serial === `ws_${serial}`,
										() => new InvalidWallpaper(undefined),
									),
									Effect.map((saved) => Option.some({ ...saved, serial })),
								),
						}),
					),
				),
		);
		const atomicWrite = Effect.fn("MediaFiles.atomicWrite")(
			(
				path: string,
				bytes: string | Buffer,
			): Effect.Effect<void, MediaPersistenceFailed> => {
				const temporary = `${path}.${randomUUID()}.tmp`;
				return Effect.tryPromise({
					try: async () => {
						await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
						await rename(temporary, path);
					},
					catch: (cause) => new MediaPersistenceFailed(cause),
				}).pipe(
					Effect.ensuring(
						Effect.promise(() => unlink(temporary).catch(() => undefined)),
					),
				);
			},
		);
		const writeSettings = Effect.fn("MediaFiles.writeSettings")(
			(
				previous: SavedWallpaper,
				next: SavedWallpaper,
			): Effect.Effect<void, MediaPersistenceFailed> =>
				Effect.gen(function* () {
					yield* Effect.tryPromise({
						try: () =>
							mkdir(join(root, "settings"), { recursive: true, mode: 0o700 }),
						catch: (cause) => new MediaPersistenceFailed(cause),
					});
					const primary = settingsPath(next.serial, false);
					const backup = settingsPath(next.serial, true);
					const stagedPrimary = `${primary}.${randomUUID()}.tmp`;
					const stagedBackup = `${backup}.${randomUUID()}.tmp`;
					const move = (from: string, to: string) =>
						Effect.tryPromise({
							try: () => rename(from, to),
							catch: (cause) => new MediaPersistenceFailed(cause),
						});
					// Stage both revisions before replacing either committed file.
					yield* Effect.gen(function* () {
						yield* Effect.tryPromise({
							try: async () => {
								await writeFile(stagedPrimary, JSON.stringify(next), {
									flag: "wx",
									mode: 0o600,
								});
								await writeFile(stagedBackup, JSON.stringify(previous), {
									flag: "wx",
									mode: 0o600,
								});
							},
							catch: (cause) => new MediaPersistenceFailed(cause),
						});
						yield* move(stagedPrimary, primary);
						// Backup failure restores the primary from the staged previous revision.
						yield* move(stagedBackup, backup).pipe(
							Effect.catchTag("MediaPersistenceFailed", (error) =>
								move(stagedBackup, primary).pipe(
									Effect.zipRight(Effect.fail(error)),
								),
							),
						);
					}).pipe(
						Effect.ensuring(
							Effect.promise(async () => {
								await unlink(stagedPrimary).catch(() => undefined);
								await unlink(stagedBackup).catch(() => undefined);
							}),
						),
					);
				}).pipe(Effect.uninterruptible),
		);
		const readLocal = Effect.fn("MediaFiles.readLocal")(
			(path: string): Effect.Effect<Buffer, MediaUnreadable> =>
				Effect.tryPromise({
					try: async () => {
						const info = await stat(path);
						if (!info.isFile() || info.size > DESKTOP_RESOURCE_LIMIT)
							throw new RangeError();
						const bytes = await readFile(path);
						if (bytes.length > DESKTOP_RESOURCE_LIMIT) throw new RangeError();
						return bytes;
					},
					catch: (cause) => new MediaUnreadable(cause),
				}),
		);
		const readAsset = Effect.fn("MediaFiles.readAsset")(
			(
				serial: string,
				reference: string,
			): Effect.Effect<Buffer, MediaUnreadable> =>
				Effect.gen(function* () {
					if (!Schema.is(AssetReference)(reference))
						return yield* new MediaUnreadable(undefined);
					const bytes = yield* readLocal(
						join(root, "assets", hash(serial), reference.slice(6)),
					).pipe(
						Effect.catchTag("MediaUnreadable", (error) =>
							absent(error.originalCause)
								? readLocal(join(root, "assets", reference.slice(6)))
								: Effect.fail(error),
						),
					);
					if (`media:${hash(bytes)}` !== reference)
						return yield* new MediaUnreadable(undefined);
					return bytes;
				}),
		);
		const storeAsset = Effect.fn("MediaFiles.storeAsset")(
			(
				serial: string,
				bytes: Buffer,
			): Effect.Effect<string, MediaPersistenceFailed> =>
				Effect.gen(function* () {
					yield* Effect.tryPromise({
						try: () =>
							mkdir(join(root, "assets", hash(serial)), {
								recursive: true,
								mode: 0o700,
							}),
						catch: (cause) => new MediaPersistenceFailed(cause),
					});
					const digest = hash(bytes);
					yield* atomicWrite(join(root, "assets", hash(serial), digest), bytes);
					return `media:${digest}`;
				}),
		);
		const collectLegacyAssets = Effect.fn("MediaFiles.collectLegacyAssets")(
			(): Effect.Effect<void, InvalidWallpaper | MediaPersistenceFailed> =>
				Effect.gen(function* () {
					const documents = yield* Effect.tryPromise({
						try: async () => {
							const names = await readdir(join(root, "settings"));
							return Promise.all(
								names
									.filter((name) => name.endsWith(".json"))
									.map(async (name) => ({
										name,
										text: await readFile(join(root, "settings", name), "utf8"),
									})),
							);
						},
						catch: (cause) => new MediaPersistenceFailed(cause),
					});
					const retained = new Set<string>();
					for (const { name, text } of documents) {
						const saved = yield* Schema.decodeUnknown(
							Schema.parseJson(SavedWallpaper),
						)(text).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(new InvalidWallpaper(cause)),
							),
						);
						if (
							name !== `${hash(saved.serial)}.json` &&
							name !== `${hash(saved.serial)}.backup.json`
						)
							return yield* new InvalidWallpaper(undefined);
						for (const media of saved.settings.displayMediaList)
							retained.add(media.filePath.slice(6));
					}
					// The pre-review layout shared a flat directory across serials.
					// Retain every reference before deleting a legacy asset.
					yield* Effect.tryPromise({
						try: async () => {
							for (const entry of await readdir(join(root, "assets"), {
								withFileTypes: true,
							}))
								if (
									entry.isFile() &&
									/^[a-f0-9]{64}$/.test(entry.name) &&
									!retained.has(entry.name)
								)
									await unlink(join(root, "assets", entry.name));
						},
						catch: (cause) => new MediaPersistenceFailed(cause),
					}).pipe(
						Effect.catchTag("MediaPersistenceFailed", (error) =>
							absent(error.originalCause) ? Effect.void : Effect.fail(error),
						),
					);
				}),
		);
		const collectAssets = Effect.fn("MediaFiles.collectAssets")(
			(
				serial: string,
				staged: readonly string[] = [],
			): Effect.Effect<void, InvalidWallpaper | MediaPersistenceFailed> =>
				Effect.gen(function* () {
					// Decode both committed revisions first. Uncertain references prevent collection.
					const current = yield* readSettings(serial);
					const backup = yield* readSettings(serial, true);

					const retained = new Set(
						[...Option.toArray(current), ...Option.toArray(backup)].flatMap(
							(saved) =>
								saved.settings.displayMediaList.map((media) =>
									media.filePath.slice(6),
								),
						),
					);
					for (const reference of staged) retained.add(reference.slice(6));
					const directory = join(root, "assets", hash(serial));
					yield* Effect.tryPromise({
						try: async () => {
							const files = await readdir(directory);
							for (const name of files)
								if (/^[a-f0-9]{64}$/.test(name) && !retained.has(name))
									await unlink(join(directory, name));
						},
						catch: (cause) => new MediaPersistenceFailed(cause),
					}).pipe(
						Effect.catchTag("MediaPersistenceFailed", (error) =>
							absent(error.originalCause) ? Effect.void : Effect.fail(error),
						),
					);
					yield* collectLegacyAssets();
				}),
		);
		return {
			readSettings,
			writeSettings,
			readLocal,
			readAsset,
			storeAsset,
			collectAssets,
		};
	}),
}) {}

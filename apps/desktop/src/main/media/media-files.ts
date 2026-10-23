import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
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
} from "../../renderer/src/wallpaper/display";

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
					try: () => readFile(settingsPath(serial, backup), "utf8"),
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
										(saved) => saved.serial === serial,
										() => new InvalidWallpaper(undefined),
									),
									Effect.map(Option.some),
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
					yield* atomicWrite(
						settingsPath(next.serial, true),
						JSON.stringify(previous),
					);
					yield* atomicWrite(
						settingsPath(next.serial, false),
						JSON.stringify(next),
					);
				}),
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
			(reference: string): Effect.Effect<Buffer, MediaUnreadable> =>
				Effect.gen(function* () {
					if (!Schema.is(AssetReference)(reference))
						return yield* new MediaUnreadable(undefined);
					const bytes = yield* readLocal(
						join(root, "assets", reference.slice(6)),
					);
					if (`media:${hash(bytes)}` !== reference)
						return yield* new MediaUnreadable(undefined);
					return bytes;
				}),
		);
		const storeAsset = Effect.fn("MediaFiles.storeAsset")(
			(bytes: Buffer): Effect.Effect<string, MediaPersistenceFailed> =>
				Effect.gen(function* () {
					yield* Effect.tryPromise({
						try: () =>
							mkdir(join(root, "assets"), { recursive: true, mode: 0o700 }),
						catch: (cause) => new MediaPersistenceFailed(cause),
					});
					const digest = hash(bytes);
					yield* atomicWrite(join(root, "assets", digest), bytes);
					return `media:${digest}`;
				}),
		);
		return { readSettings, writeSettings, readLocal, readAsset, storeAsset };
	}),
}) {}

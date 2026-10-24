import { Context, Effect, Layer, Schema } from "effect";
import { EmojiStore, emptyEmojiStore } from "./emoji-contracts";
import { EmojiLibraryFailed } from "./emoji-errors";
export interface EmojiStoragePort {
	readonly read: () => Promise<unknown>;
	readonly write: (value: EmojiStore) => Promise<void>;
}
export class EmojiStorage extends Context.Tag("@open-quake/EmojiStorage")<
	EmojiStorage,
	EmojiStoragePort
>() {}
export class EmojiRepository extends Effect.Service<EmojiRepository>()(
	"@open-quake/EmojiRepository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const storage = yield* EmojiStorage;
			const mutex = yield* Effect.makeSemaphore(1);
			let cached: EmojiStore | undefined;
			const read = Effect.fn("EmojiRepository.read")(
				function* (): Effect.fn.Return<EmojiStore, EmojiLibraryFailed> {
					if (cached) return cached;
					const raw = yield* Effect.tryPromise({
						try: storage.read,
						catch: (cause) => new EmojiLibraryFailed(cause),
					});
					if (raw === null) {
						cached = emptyEmojiStore;
						return cached;
					}
					cached = yield* Schema.decodeUnknown(EmojiStore)(raw, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(new EmojiLibraryFailed(cause)),
						),
					);
					return cached;
				},
			);
			const transact = Effect.fn("EmojiRepository.transact")(function* <E>(
				change: (state: EmojiStore) => Effect.Effect<EmojiStore, E>,
			): Effect.fn.Return<EmojiStore, EmojiLibraryFailed | E> {
				return yield* Effect.gen(function* () {
					const current = yield* read();
					const next = yield* change(current);
					const decoded = yield* Schema.decodeUnknown(EmojiStore)(next).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(new EmojiLibraryFailed(cause)),
						),
					);
					yield* Effect.tryPromise({
						try: () => storage.write(decoded),
						catch: (cause) => new EmojiLibraryFailed(cause),
					});
					cached = decoded;
					return decoded;
				}).pipe(mutex.withPermits(1), Effect.uninterruptible);
			});
			return { read, transact };
		}),
	},
) {}
export const emojiStorageLayer = (port: EmojiStoragePort) =>
	Layer.succeed(EmojiStorage, port);

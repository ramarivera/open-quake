import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Context, Effect, Either, Layer, Option, Schema } from "effect";
import type { SessionId } from "./chat-contracts.js";
import {
	type ChatError,
	ChatNotFound,
	ChatStorageFailed,
} from "./chat-errors.js";

import { ChatHistory } from "./chat-history-contracts.js";

export { ChatHistory, SavedTurn } from "./chat-history-contracts.js";

const Document = Schema.Struct({
	version: Schema.Literal(1),
	sessions: Schema.Array(ChatHistory),
});
export type ChatDocument = typeof Document.Type;
function immutable<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) immutable(child);
		Object.freeze(value);
	}
	return value;
}
const historyCopy = (history: ChatHistory): ChatHistory =>
	immutable(
		Schema.decodeUnknownSync(ChatHistory)(
			Schema.encodeSync(ChatHistory)(history),
		),
	);

/** Storage must replace the whole versioned document atomically; absence is a new store. */
export class ChatStorage extends Context.Tag("@open-quake/edge/ChatStorage")<
	ChatStorage,
	{
		readonly load: Effect.Effect<Option.Option<unknown>, ChatStorageFailed>;
		readonly save: (
			document: ChatDocument,
		) => Effect.Effect<void, ChatStorageFailed>;
	}
>() {}

/** Host-only durable implementation. Pass a private subdirectory of app.getPath('userData'). */
export const fileChatStorageLayer = (
	directory: string,
): Layer.Layer<ChatStorage> =>
	Layer.succeed(ChatStorage, {
		load: Effect.tryPromise({
			try: async () => {
				try {
					if (
						(await stat(join(directory, "history-v1.json"))).size >
						64 * 1024 * 1024
					)
						throw new ChatStorageFailed();
					const text = await readFile(
						join(directory, "history-v1.json"),
						"utf8",
					);
					if (Buffer.byteLength(text) > 64 * 1024 * 1024)
						throw new ChatStorageFailed();
					return Option.some(JSON.parse(text) as unknown);
				} catch (cause) {
					if (
						cause instanceof Error &&
						"code" in cause &&
						cause.code === "ENOENT"
					)
						return Option.none();
					throw cause;
				}
			},
			catch: (cause) => new ChatStorageFailed(cause),
		}),
		save: Effect.fn("FileChatStorage.save")(
			(document): Effect.Effect<void, ChatStorageFailed> =>
				Effect.tryPromise({
					try: async () => {
						const text = JSON.stringify(Schema.encodeSync(Document)(document));
						if (Buffer.byteLength(text) > 64 * 1024 * 1024)
							throw new ChatStorageFailed();
						await mkdir(directory, { recursive: true, mode: 0o700 });
						const temporary = join(directory, `.history-${randomUUID()}.json`);
						let committed = false;
						try {
							const file = await open(temporary, "wx", 0o600);
							try {
								await file.writeFile(text, "utf8");
								await file.sync();
							} finally {
								await file.close();
							}
							await rename(temporary, join(directory, "history-v1.json"));
							committed = true;
						} finally {
							// Rename consumes the temporary path. Cleanup must never turn a
							// committed replacement into a reported failed save.
							if (!committed)
								await unlink(temporary).catch((cause) => {
									if (
										!(
											cause instanceof Error &&
											"code" in cause &&
											cause.code === "ENOENT"
										)
									)
										throw cause;
								});
						}
					},
					catch: (cause) => new ChatStorageFailed(cause),
				}),
		),
	});

export class ChatRepository extends Effect.Service<ChatRepository>()(
	"@open-quake/edge/ChatRepository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const storage = yield* ChatStorage;
			const lock = yield* Effect.makeSemaphore(1);
			const loaded = yield* storage.load;
			const decoded = Schema.decodeUnknownEither(Document, {
				onExcessProperty: "error",
			})(Option.isSome(loaded) ? loaded.value : { version: 1, sessions: [] });
			if (Either.isLeft(decoded))
				return yield* new ChatStorageFailed(decoded.left);
			let document: ChatDocument = immutable(decoded.right);
			// A crash never resumes inference or admits a partial exchange to context.
			const recovered: ChatDocument = {
				version: 1,
				sessions: document.sessions.map((session) => ({
					...session,
					turns: session.turns.map((turn) =>
						turn.status !== "processing"
							? turn
							: {
									...turn,
									status: "interrupted" as const,
									snapshot: {
										...turn.snapshot,
										terminal: Option.some({
											outcome: "failed" as const,
											errorCode: "CHAT.RESPONSE.INTERRUPTED",
										}),
									},
								},
					),
				})),
			};
			if (
				document.sessions.some((session) =>
					session.turns.some((turn) => turn.status === "processing"),
				)
			) {
				yield* storage.save(recovered);
				document = immutable(recovered);
			}
			const get = Effect.fn("ChatRepository.get")(
				(
					owner: string,
					id: SessionId,
				): Effect.Effect<Option.Option<ChatHistory>> =>
					lock.withPermits(1)(
						Effect.sync(() =>
							Option.fromNullable(
								document.sessions.find(
									(session) =>
										session.owner === owner && session.sessionId === id,
								),
							),
						),
					),
			);
			const list = Effect.fn("ChatRepository.list")(
				(owner: string): Effect.Effect<readonly ChatHistory[]> =>
					lock.withPermits(1)(
						Effect.sync(() =>
							document.sessions.filter((session) => session.owner === owner),
						),
					),
			);
			const put = Effect.fn("ChatRepository.put")(
				(
					history: ChatHistory,
					expectedRevision: number,
				): Effect.Effect<void, ChatError> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const ownedHistory = yield* Effect.try({
								try: () => historyCopy(history),
								catch: (cause) => new ChatStorageFailed(cause),
							});
							const previous = document.sessions.find(
								(session) =>
									session.owner === history.owner &&
									session.sessionId === history.sessionId,
							);
							if ((previous?.revision ?? -1) !== expectedRevision)
								return yield* new ChatNotFound();
							const next = {
								version: 1 as const,
								sessions: [
									...document.sessions.filter(
										(session) => session !== previous,
									),
									ownedHistory,
								],
							};
							yield* storage.save(next);
							document = immutable(next);
						}).pipe(Effect.uninterruptible),
					),
			);
			const remove = Effect.fn("ChatRepository.remove")(
				(
					owner: string,
					id: SessionId,
				): Effect.Effect<void, ChatStorageFailed> =>
					lock.withPermits(1)(
						Effect.gen(function* () {
							const next = {
								version: 1 as const,
								sessions: document.sessions.filter(
									(session) =>
										session.owner !== owner || session.sessionId !== id,
								),
							};
							yield* storage.save(next);
							document = immutable(next);
						}).pipe(Effect.uninterruptible),
					),
			);
			return { get, list, put, remove };
		}),
	},
) {}

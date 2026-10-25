import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Layer, Option, Schema } from "effect";
import { vi } from "vitest";
import { workflowProfile } from "../ai/ai-test-fixtures.js";
import { SessionId, TurnId } from "./chat-contracts.js";
import { ChatStorageFailed } from "./chat-errors.js";
import { emptyTurn } from "./chat-invariants.js";
import {
	type ChatHistory,
	ChatRepository,
	ChatStorage,
	fileChatStorageLayer,
} from "./chat-repository.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, unlink: vi.fn(actual.unlink) };
});

const sid = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000777",
);
const tid = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000888",
);
const history: ChatHistory = {
	owner: "private-window-a",
	sessionId: sid,
	revision: 0,
	contextEpoch: 0,
	updatedAt: 0,
	title: "private chat",
	manualTitle: false,
	turns: [
		{
			selection: {
				sessionId: sid,
				turnId: tid,
				profileId: workflowProfile.id,
				modelId: "daily",
				authGeneration: 0,
				mode: "normal",
			},
			input: "private user text",
			snapshot: { ...emptyTurn(sid, tid), text: "saved partial", lastSeq: 0 },
			contextEpoch: 0,
			status: "processing",
		},
	],
};
const scratch = tmpdir();

describe("private durable chat repository", () => {
	it("atomically persists private history, recovers interrupted output on restart, isolates owners and deletes durably", async () => {
		const directory = join(scratch, `history-test-${randomUUID()}`);
		const layer = ChatRepository.Default.pipe(
			Layer.provide(fileChatStorageLayer(directory)),
		);
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const repo = yield* ChatRepository;
					yield* repo.put(history, -1);
				}).pipe(Effect.provide(layer)),
			);
			const mode =
				(await stat(join(directory, "history-v1.json"))).mode & 0o777;
			expect(mode).toBe(0o600);
			expect((await stat(directory)).mode & 0o777).toBe(0o700);
			await Effect.runPromise(
				Effect.gen(function* () {
					const repo = yield* ChatRepository;
					expect(yield* repo.get("other-owner", sid)).toEqual(Option.none());
					const current = yield* repo.get(history.owner, sid);
					expect(Option.isSome(current)).toBe(true);
					if (Option.isSome(current)) {
						expect(current.value.turns[0]?.status).toBe("interrupted");
						expect(current.value.turns[0]?.snapshot.text).toBe("saved partial");
						expect(current.value.turns[0]?.snapshot.terminal).toEqual(
							Option.some({
								outcome: "failed",
								errorCode: "CHAT.RESPONSE.INTERRUPTED",
							}),
						);
					}
					yield* repo.remove(history.owner, sid);
					const late = yield* Effect.either(
						repo.put({ ...history, revision: 1 }, 0),
					);
					expect(Either.isLeft(late) && late.left.code).toBe(
						"CHAT.SESSION.NOT_FOUND",
					);
				}).pipe(Effect.provide(layer)),
			);
			const saved: unknown = JSON.parse(
				await readFile(join(directory, "history-v1.json"), "utf8"),
			);
			expect(saved).toEqual({ version: 1, sessions: [] });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("does not attempt temporary cleanup after rename, keeping memory and disk revisions aligned", async () => {
		const directory = join(scratch, `committed-test-${randomUUID()}`);
		const layer = ChatRepository.Default.pipe(
			Layer.provide(fileChatStorageLayer(directory)),
		);
		const cleanup = vi.mocked(unlink);
		cleanup.mockClear();
		cleanup.mockRejectedValue(
			Object.assign(new Error("cleanup denied"), { code: "EACCES" }),
		);
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const repo = yield* ChatRepository;
					yield* repo.put(history, -1);
					yield* repo.put(
						{ ...history, revision: 1, title: "second revision" },
						0,
					);
					const current = yield* repo.get(history.owner, sid);
					expect(Option.isSome(current) && current.value.revision).toBe(1);
					expect(Option.isSome(current) && current.value.title).toBe(
						"second revision",
					);
				}).pipe(Effect.provide(layer)),
			);
			const saved: unknown = JSON.parse(
				await readFile(join(directory, "history-v1.json"), "utf8"),
			);
			expect(saved).toMatchObject({
				sessions: [{ revision: 1, title: "second revision" }],
			});
			expect(cleanup).not.toHaveBeenCalled();
		} finally {
			cleanup.mockReset();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rejects unknown versions without rewriting or partially migrating history", async () => {
		const directory = join(scratch, `version-test-${randomUUID()}`);
		await mkdir(directory, { mode: 0o700 });
		const original = '{"version":2,"sessions":[],"future":"retain me"}';
		await writeFile(join(directory, "history-v1.json"), original, {
			mode: 0o600,
		});
		try {
			const exit = await Effect.runPromise(
				Effect.either(
					ChatRepository.list(history.owner).pipe(
						Effect.provide(
							ChatRepository.Default.pipe(
								Layer.provide(fileChatStorageLayer(directory)),
							),
						),
					),
				),
			);
			expect(Either.isLeft(exit) && exit.left.code).toBe(
				"CHAT.HISTORY.STORAGE_FAILED",
			);
			expect(await readFile(join(directory, "history-v1.json"), "utf8")).toBe(
				original,
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it.effect(
		"a failed atomic save retains previous state and privately retains the storage cause",
		() => {
			let fail = false;
			const cause = new Error("private text and key https://private.invalid");
			const storage = Layer.succeed(ChatStorage, {
				load: Effect.succeed(Option.none()),
				save: () =>
					fail ? Effect.fail(new ChatStorageFailed(cause)) : Effect.void,
			});
			return Effect.gen(function* () {
				const repo = yield* ChatRepository;
				yield* repo.put(history, -1);
				fail = true;
				const result = yield* Effect.either(repo.remove(history.owner, sid));
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left.originalCause).toBe(cause);
					expect(result.left.code).toBe("CHAT.HISTORY.STORAGE_FAILED");
					expect(JSON.stringify(result.left)).not.toMatch(
						/private text|private.invalid/,
					);
				}
				const retained = yield* repo.get(history.owner, sid);
				expect(Option.isSome(retained) && retained.value.turns[0]?.status).toBe(
					"processing",
				);
			}).pipe(
				Effect.provide(ChatRepository.Default.pipe(Layer.provide(storage))),
			);
		},
	);
});

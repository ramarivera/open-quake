import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConversationRepository } from "./conversation-repository.js";

const scope = { connectionId: "connection", sessionId: "request" };
const start = {
	connectionId: "connection",
	requestId: "request",
	text: "hello",
};
describe("bounded conversation repository", () => {
	it("rotates the replay budget without forgetting active or retained requests", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* ConversationRepository;
				yield* repo.begin("active-owner", start, "binding");
				for (let index = 0; index < 4100; index++) {
					const requestId = `turn-${index}`;
					yield* repo.begin("owner", { ...start, requestId }, "binding");
					yield* repo.finish(
						"owner",
						{ ...scope, sessionId: requestId },
						requestId,
						"completed",
					);
				}
				expect(
					(yield* repo
						.begin("active-owner", start, "binding")
						.pipe(Effect.either))._tag,
				).toBe("Left");
				expect(
					(yield* repo
						.begin("owner", { ...start, requestId: "turn-4099" }, "binding")
						.pipe(Effect.either))._tag,
				).toBe("Left");
				yield* repo.clear("owner", { connectionId: "connection" });
				expect(
					(yield* repo
						.begin("owner", { ...start, requestId: "turn-4099" }, "binding")
						.pipe(Effect.either))._tag,
				).toBe("Left");
				expect(
					(yield* repo.begin(
						"owner",
						{ ...start, requestId: "after-clear" },
						"binding",
					)).history.turns,
				).toHaveLength(1);
			}).pipe(Effect.provide(ConversationRepository.Default)),
		);
	});
	it("rejects clear while active, preserves snapshots and keeps replay tombstones after clear", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* ConversationRepository;
				const before = yield* repo.begin("owner", start, "binding");
				expect(
					(yield* repo.clear("owner", scope).pipe(Effect.either))._tag,
				).toBe("Left");
				yield* repo.append("owner", scope, "request", "answer");
				yield* repo.finish(
					"owner",
					scope,
					"request",
					"completed",
					"private-session",
				);
				expect(before.history.turns[0]?.answer).toBe("");
				yield* repo.clear("owner", scope);
				expect(yield* repo.history("owner", scope)).toEqual([]);
				expect(
					(yield* repo.begin("owner", start, "binding").pipe(Effect.either))
						._tag,
				).toBe("Left");
			}).pipe(Effect.provide(ConversationRepository.Default)),
		);
	});
	it("bounds turns and transcript characters while keeping successful context only", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* ConversationRepository;
				for (let index = 0; index < 40; index++) {
					const requestId = `request-${index}`;
					yield* repo.begin(
						"owner",
						{
							connectionId: "connection",
							requestId,
							...(index === 0 ? {} : { sessionId: "request-0" }),
							text: "x".repeat(10000),
						},
						"binding",
					);
					yield* repo.append(
						"owner",
						{ ...scope, sessionId: "request-0" },
						requestId,
						"y".repeat(20000),
					);
					yield* repo.finish(
						"owner",
						{ ...scope, sessionId: "request-0" },
						requestId,
						index % 2 === 0 ? "completed" : "cancelled",
					);
				}
				const history = yield* repo.history("owner", {
					connectionId: "connection",
				});
				expect(history[0]?.turns.length).toBeLessThanOrEqual(32);
				expect(
					history[0]?.turns.reduce(
						(sum, turn) => sum + turn.text.length + turn.answer.length,
						0,
					),
				).toBeLessThanOrEqual(262144);
				const next = yield* repo.begin(
					"owner",
					{ ...start, sessionId: "request-0", requestId: "next" },
					"binding",
				);
				expect(next.messages.at(-1)).toEqual({
					role: "user",
					content: "hello",
				});
				expect(next.messages.length).toBe(
					(history[0]?.turns.filter((turn) => turn.outcome === "completed")
						.length ?? 0) *
						2 +
						1,
				);
			}).pipe(Effect.provide(ConversationRepository.Default)),
		);
	});
	it("evicts only idle sessions at the global bound", async () => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* ConversationRepository;
				for (let index = 0; index < 65; index++) {
					const requestId = `request-${index}`;
					yield* repo.begin("owner", { ...start, requestId }, "binding");
					yield* repo.finish(
						"owner",
						{ ...scope, sessionId: requestId },
						requestId,
						"completed",
					);
				}
				expect(
					(yield* repo.history("owner", { connectionId: "connection" })).length,
				).toBe(64);
				expect(
					yield* repo.history("owner", { ...scope, sessionId: "request-0" }),
				).toEqual([]);
			}).pipe(Effect.provide(ConversationRepository.Default)),
		);
	});
	it("scope keys remain distinct for arbitrary owner and agent punctuation", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.string({ minLength: 1, maxLength: 30 }),
				fc.string({ minLength: 1, maxLength: 30 }),
				async (owner, agent) => {
					await Effect.runPromise(
						Effect.gen(function* () {
							const repo = yield* ConversationRepository;
							yield* repo.begin(owner, { ...start, agentId: agent }, "binding");
							expect(
								yield* repo.history(`${owner}:other`, {
									...scope,
									agentId: agent,
								}),
							).toEqual([]);
							expect(
								yield* repo.history(owner, {
									...scope,
									agentId: `${agent}:other`,
								}),
							).toEqual([]);
							expect(
								(yield* repo.history(owner, { ...scope, agentId: agent }))
									.length,
							).toBe(1);
						}).pipe(Effect.provide(ConversationRepository.Default)),
					);
				},
			),
			{ numRuns: 50 },
		);
	});
});

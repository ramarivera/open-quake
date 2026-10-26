import { describe, expect, it } from "@effect/vitest";
import {
	Chunk,
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Queue,
	Redacted,
	Schema,
	Stream,
	TestClock,
} from "effect";
import {
	AiCompatibleAdapter,
	type CompatibleAdapter,
} from "../ai/adapters/adapter.js";
import { makeVercelCompatibleAdapter } from "../ai/adapters/vercel.js";
import type { InferenceRequest, NormalizedEvent } from "../ai/ai-contracts.js";
import { AiCredentials } from "../ai/ai-credentials.js";
import { AiAuthRevoked, AiRateLimited } from "../ai/ai-errors.js";
import { AiRepository } from "../ai/ai-repository.js";
import { workflowProfile } from "../ai/ai-test-fixtures.js";
import { type ChatChunk, SessionId, TurnId } from "./chat-contracts.js";
import { ChatStorageFailed } from "./chat-errors.js";
import { emptyTurn, reduceChunk, restoreSnapshot } from "./chat-invariants.js";
import { ChatInferenceLive, type ChatSubmit } from "./chat-ports.js";
import {
	type ChatDocument,
	ChatHistory,
	ChatRepository,
	ChatStorage,
} from "./chat-repository.js";
import { ChatService } from "./chat-service.js";

const sid = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000100",
);
const tid = (number: number) =>
	Schema.decodeUnknownSync(TurnId)(
		`00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
	);
const input = (number = 1, extra: Partial<ChatSubmit> = {}): ChatSubmit => ({
	sessionId: sid,
	turnId: tid(number),
	profileId: workflowProfile.id,
	modelId: "daily",
	authGeneration: 0,
	mode: "normal",
	text: "hello world",
	...extra,
});
const text = (value: string): NormalizedEvent => ({
	_tag: "textDelta",
	textDelta: value,
	kind: "generation",
});
const complete: NormalizedEvent = { _tag: "completed" };
const memory = () => {
	let saved: unknown;
	const writes: ChatDocument[] = [];
	return {
		writes,
		layer: Layer.succeed(ChatStorage, {
			load: Effect.sync(() => Option.fromNullable(saved)),
			save: (document) =>
				Effect.sync(() => {
					writes.push(document);
					saved = {
						version: 1,
						sessions: document.sessions.map((session) =>
							Schema.encodeSync(ChatHistory)(session),
						),
					};
				}),
		}),
	};
};
const testLayer = (
	adapter: CompatibleAdapter,
	storage = memory().layer,
	credentials: typeof AiCredentials.Service = {
		resolve: () => Effect.succeed(Redacted.make("private-fixture-key")),
		revoked: () => Effect.never,
	},
) => {
	const inference = ChatInferenceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiCompatibleAdapter, adapter),
				Layer.succeed(AiCredentials, credentials),
			),
		),
	);
	return ChatService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				ChatRepository.Default.pipe(Layer.provide(storage)),
				AiRepository.Default,
				inference,
			),
		),
	);
};
const initialize = Effect.gen(function* () {
	yield* (yield* AiRepository).put(workflowProfile);
	return yield* ChatService;
});
const chunks = (events: Stream.Stream<ChatChunk, unknown>) =>
	Stream.runCollect(events).pipe(Effect.map(Chunk.toReadonlyArray));

describe("ChatService real facade consumers", () => {
	for (const answer of ["", " \t\n"])
		it.effect(
			`AI-093 rejects completed blank answer ${JSON.stringify(answer)} once`,
			() =>
				Effect.gen(function* () {
					const service = yield* initialize;
					const turn = yield* service.submit("window-a", input());
					const actual = yield* chunks(turn.events);
					expect(actual.filter((event) => event.type === "end")).toMatchObject([
						{ outcome: "failed", errorCode: "AI.PROVIDER.PROTOCOL_INVALID" },
					]);
					const history = yield* service.history("window-a", sid);
					expect(history.turns[0]?.status).toBe("failed");
					expect(yield* service.session("window-a", sid)).toMatchObject({
						state: "EMPTY",
						hasCompletedExchange: false,
					});
				}).pipe(
					Effect.provide(
						testLayer({
							open: () => Effect.succeed(Stream.make(text(answer), complete)),
						}),
					),
				),
		);
	it.effect(
		"assembles exact chunks once, persists partial text and fans out through real reducers",
		() => {
			const store = memory();
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("window-a", input());
				const panel = yield* service.subscribe("window-a", sid, tid(1));
				const managementResult = yield* chunks(turn.events).pipe(Effect.fork);
				const panelResult = yield* chunks(panel.events).pipe(Effect.fork);
				yield* Queue.offerAll(queue, [
					text("Hel"),
					text("lo"),
					{ _tag: "suggestion", suggestionId: "next", text: "continue" },
					{
						_tag: "usage",
						usage: { inputTokens: 9, outputTokens: 2, provenance: "reported" },
					},
					complete,
					text("late"),
				]);
				const actual = yield* Fiber.join(managementResult);
				expect(yield* Fiber.join(panelResult)).toEqual(actual);
				expect(actual.map((chunk) => [chunk.seq, chunk.type])).toEqual([
					[0, "answer"],
					[1, "answer"],
					[2, "followUp"],
					[3, "end"],
				]);
				const view = actual.reduce(
					reduceChunk,
					restoreSnapshot(emptyTurn(sid, tid(1)), turn.snapshot),
				);
				expect(view.text).toBe("Hello");
				expect(view.suggestions[0]?.text).toBe("continue");
				expect(view.terminal).toEqual(
					Option.some({
						outcome: "completed",
						usage: { inputTokens: 9, outputTokens: 2, provenance: "reported" },
					}),
				);
				expect(yield* service.session("window-a", sid)).toMatchObject({
					state: "IDLE",
					hasCompletedExchange: true,
				});
				expect((yield* service.history("window-a", sid)).title).toBe(
					"hello worl...",
				);
				expect(
					store.writes.some(
						(document) =>
							document.sessions[0]?.turns[0]?.snapshot.text === "Hel",
					),
				).toBe(true);
				expect(JSON.stringify(store.writes)).not.toContain(
					"private-fixture-key",
				);
			}).pipe(
				Effect.provide(
					testLayer(
						{ open: () => Effect.succeed(Stream.fromQueue(queue)) },
						store.layer,
					),
				),
			);
		},
	);
});

describe("ChatService ownership and lifetime", () => {
	it.effect(
		"rejects busy, stale selections, disabled modes and oversized context before provider I/O",
		() => {
			let calls = 0;
			return Effect.gen(function* () {
				const service = yield* initialize;
				for (const extra of [
					{ mode: "operatePC" as const },
					{ modelId: "wrong" },
					{ authGeneration: 1 },
					{ contextWindowTokens: 32, outputReserveTokens: 31 },
				]) {
					const result = yield* Effect.either(
						service.submit("a", input(1, extra)),
					);
					expect(Either.isLeft(result)).toBe(true);
				}
				expect(calls).toBe(0);
				yield* service.submit("a", input());
				const busy = yield* Effect.either(service.submit("a", input(2)));
				expect(Either.isLeft(busy) && busy.left.code).toBe("CHAT.SESSION.BUSY");
				const foreign = yield* Effect.either(
					service.snapshot("other", sid, tid(1)),
				);
				expect(Either.isLeft(foreign) && foreign.left.code).toBe(
					"CHAT.SESSION.NOT_FOUND",
				);
				yield* service.cancel("a", sid, tid(1));
			}).pipe(
				Effect.provide(
					testLayer({
						open: () => {
							calls++;
							return Effect.succeed(Stream.never);
						},
					}),
				),
			);
		},
	);
	it.effect(
		"cancel before first token aborts setup, produces one seq0 terminal, keeps another owner running",
		() => {
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			const opened = Effect.runSync(Queue.unbounded<void>());
			return Effect.gen(function* () {
				const service = yield* initialize;
				const a = yield* service.submit("a", input());
				const b = yield* service.submit("b", input(2));
				yield* Queue.take(opened);
				yield* Queue.take(opened);
				yield* service.cancel("a", sid, tid(1));
				expect(yield* chunks(a.events)).toMatchObject([
					{ seq: 0, type: "end", outcome: "cancelled" },
				]);
				expect(calls[0]?.signal.aborted).toBe(true);
				expect(calls[1]?.signal.aborted).toBe(false);
				expect(yield* service.session("a", sid)).toMatchObject({
					state: "EMPTY",
				});
				yield* service.cancel("b", sid, tid(2));
				expect(yield* chunks(b.events)).toHaveLength(1);
			}).pipe(
				Effect.provide(
					testLayer({
						open: (value) => {
							calls.push(value);
							return Queue.offer(opened, undefined).pipe(
								Effect.zipRight(Effect.never),
							);
						},
					}),
				),
			);
		},
	);
	it.effect(
		"pins the profile and credentials even if settings change after acceptance",
		() => {
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			return Effect.gen(function* () {
				const service = yield* initialize;
				const a = yield* service.submit("a", input());
				yield* (yield* AiRepository).put({
					...workflowProfile,
					models: { daily: "new-model" },
					authGeneration: 3,
					baseUrl: "https://changed.invalid/v1",
				});
				const aChunks = yield* chunks(a.events);
				expect(aChunks.at(-1)).toMatchObject({ outcome: "completed" });
				expect(calls[0]?.profile.modelId).toBe("daily");
				expect(calls[0]?.profile.baseUrl).toBe(workflowProfile.baseUrl);
				expect(calls[0]?.profile.authGeneration).toBe(0);
				const b = yield* service.submit(
					"a",
					input(2, { modelId: "new-model", authGeneration: 3 }),
				);
				yield* chunks(b.events);
				expect(calls[1]?.profile.modelId).toBe("new-model");
				expect(calls[1]?.profile.authGeneration).toBe(3);
			}).pipe(
				Effect.provide(
					testLayer({
						open: (value) => {
							calls.push(value);
							return Effect.succeed(Stream.make(text("ok"), complete));
						},
					}),
				),
			);
		},
	);
	it.effect(
		"uses an absolute deadline despite deltas, physically aborts, and excludes partial output from context",
		() => {
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			const opened = Effect.runSync(Queue.unbounded<void>());
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			return Effect.gen(function* () {
				const service = yield* initialize;
				const a = yield* service.submit("a", input());
				const consumer = yield* chunks(a.events).pipe(Effect.fork);
				yield* Queue.take(opened);
				yield* TestClock.adjust(59999);
				yield* Queue.offer(queue, text("partial"));
				yield* Effect.yieldNow();
				yield* TestClock.adjust(1);
				const result = yield* Fiber.join(consumer);
				expect(result.at(-1)).toMatchObject({
					outcome: "timedOut",
					errorCode: "CHAT.RESPONSE.TIMEOUT",
				});
				expect(result.filter((chunk) => chunk.type === "end")).toHaveLength(1);
				expect(calls[0]?.signal.aborted).toBe(true);
				const b = yield* service.submit("a", input(2, { text: "next" }));
				yield* Queue.take(opened);
				yield* service.cancel("a", sid, tid(2));
				expect(
					calls[1]?.request.messages.map((message) => message.content),
				).toEqual([[{ _tag: "text", text: "next" }]]);
				yield* chunks(b.events);
			}).pipe(
				Effect.provide(
					testLayer({
						open: (value) => {
							calls.push(value);
							return Queue.offer(opened, undefined).pipe(
								Effect.as(Stream.fromQueue(queue)),
							);
						},
					}),
				),
			);
		},
	);
	it.effect(
		"cancels superseded turns and close releases context while retaining history",
		() => {
			const calls: Parameters<CompatibleAdapter["open"]>[0][] = [];
			return Effect.gen(function* () {
				const service = yield* initialize;
				const first = yield* service.submit("a", input());
				const second = yield* service.supersede("a", input(2));
				expect((yield* chunks(first.events)).at(-1)).toMatchObject({
					outcome: "cancelled",
				});
				yield* service.close("a", sid);
				expect((yield* chunks(second.events)).at(-1)).toMatchObject({
					outcome: "cancelled",
				});
				expect((yield* service.history("a", sid)).turns).toHaveLength(2);
				expect(yield* service.session("a", sid)).toMatchObject({
					state: "EMPTY",
				});
				yield* service.clear("a", sid);
				expect(yield* service.list("a")).toEqual([]);
				expect(calls.every((call) => call.signal.aborted)).toBe(true);
			}).pipe(
				Effect.provide(
					testLayer({
						open: (value) => {
							calls.push(value);
							return Effect.succeed(Stream.never);
						},
					}),
				),
			);
		},
	);
	it.effect(
		"auth revocation preserves provider identity and aborts active stream",
		() => {
			const revoked = Effect.runSync(Deferred.make<never, AiAuthRevoked>());
			const opened = Effect.runSync(Deferred.make<void>());
			let signal = new AbortController().signal;
			return Effect.gen(function* () {
				const service = yield* initialize;
				const a = yield* service.submit("a", input());
				yield* Deferred.await(opened);
				yield* Deferred.fail(
					revoked,
					new AiAuthRevoked(new Error("private key and text")),
				);
				expect((yield* chunks(a.events)).at(-1)).toMatchObject({
					outcome: "failed",
					errorCode: "AI.PROVIDER.AUTH_REVOKED",
				});
				expect(signal.aborted).toBe(true);
			}).pipe(
				Effect.provide(
					testLayer(
						{
							open: (value) => {
								signal = value.signal;
								return Deferred.succeed(opened, undefined).pipe(
									Effect.as(Stream.never),
								);
							},
						},
						memory().layer,
						{
							resolve: () => Effect.succeed(Redacted.make("key")),
							revoked: () => Deferred.await(revoked),
						},
					),
				),
			);
		},
	);
	it.effect(
		"slow subscribers overflow independently, recover authoritative snapshot, and never restart inference",
		() => {
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			let calls = 0;
			return Effect.gen(function* () {
				const service = yield* initialize;
				const management = yield* service.submit(
					"a",
					input(1, { outputReserveTokens: 2048 }),
				);
				const slow = yield* service.subscribe("a", sid, tid(1));
				const fast = yield* chunks(management.events).pipe(Effect.fork);
				yield* Queue.offerAll(queue, [
					...Array.from({ length: 300 }, () => text("x")),
					complete,
				]);
				const actual = yield* Fiber.join(fast);
				expect(actual).toHaveLength(301);
				const overflow = yield* Effect.either(chunks(slow.events));
				expect(
					Either.isLeft(overflow) &&
						typeof overflow.left === "object" &&
						overflow.left !== null &&
						"code" in overflow.left &&
						overflow.left.code,
				).toBe("CHAT.STREAM.RESYNC_REQUIRED");
				const snapshot = yield* service.snapshot("a", sid, tid(1));
				expect(snapshot.text).toHaveLength(300);
				expect(snapshot.lastSeq).toBe(300);
				const recovered = restoreSnapshot(emptyTurn(sid, tid(1)), snapshot);
				expect(recovered.terminal).toEqual(
					Option.some({
						outcome: "completed",
						usage: {
							inputTokens: 19,
							outputTokens: 300,
							provenance: "estimated",
						},
					}),
				);
				expect(calls).toBe(1);
			}).pipe(
				Effect.provide(
					testLayer({
						open: () => {
							calls++;
							return Effect.succeed(Stream.fromQueue(queue));
						},
					}),
				),
			);
		},
	);
	it.effect(
		"retains complete pairs only, trims oldest whole pairs, expires context and preserves manual title",
		() => {
			const requests: InferenceRequest[] = [];
			return Effect.gen(function* () {
				const service = yield* initialize;
				yield* chunks(
					(yield* service.submit("a", input(1, { text: "old" }))).events,
				);
				yield* chunks(
					(yield* service.submit("a", input(2, { text: "new" }))).events,
				);
				yield* service.rename("a", sid, "mine");
				yield* chunks(
					(yield* service.submit(
						"a",
						input(3, {
							text: "now",
							contextWindowTokens: 80,
							outputReserveTokens: 32,
						}),
					)).events,
				);
				expect(requests[2]?.messages.map((message) => message.content)).toEqual(
					[
						[{ _tag: "text", text: "new" }],
						[{ _tag: "text", text: "answer" }],
						[{ _tag: "text", text: "now" }],
					],
				);
				expect((yield* service.history("a", sid)).title).toBe("mine");
				yield* TestClock.adjust(30 * 60 * 1000);
				expect(yield* service.session("a", sid)).toMatchObject({
					state: "EMPTY",
				});
				yield* chunks(
					(yield* service.submit("a", input(4, { text: "after idle" }))).events,
				);
				expect(requests[3]?.messages).toHaveLength(1);
				yield* service.close("a", sid);
				yield* chunks((yield* service.submit("a", input(5))).events);
				expect(requests[4]?.messages).toHaveLength(1);
				expect((yield* service.history("a", sid)).turns).toHaveLength(5);
			}).pipe(
				Effect.provide(
					testLayer({
						open: (value) => {
							requests.push(value.request);
							return Effect.succeed(Stream.make(text("answer"), complete));
						},
					}),
				),
			);
		},
	);
	it.effect(
		"keeps private partial generation with stable failure and no duplicate retry",
		() => {
			let calls = 0;
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				const actual = yield* chunks(turn.events);
				expect(actual).toMatchObject([
					{ type: "answer", textDelta: "partial" },
					{
						type: "end",
						outcome: "failed",
						errorCode: "AI.PROVIDER.RATE_LIMITED",
					},
				]);
				const history = yield* service.history("a", sid);
				expect(history.turns[0]?.snapshot.text).toBe("partial");
				expect(history.turns[0]?.status).toBe("failed");
				expect(JSON.stringify(history)).not.toContain("secret");
				expect(calls).toBe(1);
			}).pipe(
				Effect.provide(
					testLayer({
						open: () => {
							calls++;
							return Effect.succeed(
								Stream.make(text("partial")).pipe(
									Stream.concat(
										Stream.fail(new AiRateLimited(new Error("secret"))),
									),
								),
							);
						},
					}),
				),
			);
		},
	);
	it.effect(
		"drives the installed production SDK through ChatService to the browser reducer",
		() => {
			let requests = 0;
			const adapter = makeVercelCompatibleAdapter(async () => {
				requests++;
				return new Response(
					'data: {"choices":[{"index":0,"delta":{"content":"<script>inert</script>"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
					{ headers: { "content-type": "text/event-stream" } },
				);
			});
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				const view = (yield* chunks(turn.events)).reduce(
					reduceChunk,
					emptyTurn(sid, tid(1)),
				);
				expect(view.text).toBe("<script>inert</script>");
				expect(
					Option.isSome(view.terminal) && view.terminal.value.outcome,
				).toBe("completed");
				expect(requests).toBe(1);
			}).pipe(Effect.provide(testLayer(adapter)));
		},
	);
});

describe("ChatService shutdown and acceptance boundaries", () => {
	it.effect(
		"disposing the service scope aborts active upstream and durably records one cancellation",
		() => {
			const store = memory();
			const opened = Effect.runSync(Deferred.make<void>());
			let signal = new AbortController().signal;
			return Effect.gen(function* () {
				yield* Effect.scoped(
					Effect.gen(function* () {
						const service = yield* initialize;
						yield* service.submit("a", input());
						yield* Deferred.await(opened);
					}).pipe(
						Effect.provide(
							testLayer(
								{
									open: (value) => {
										signal = value.signal;
										return Deferred.succeed(opened, undefined).pipe(
											Effect.as(Stream.never),
										);
									},
								},
								store.layer,
							),
						),
					),
				);
				expect(signal.aborted).toBe(true);
				expect(store.writes.at(-1)?.sessions[0]?.turns[0]?.status).toBe(
					"cancelled",
				);
				expect(
					store.writes.at(-1)?.sessions[0]?.turns[0]?.snapshot.terminal,
				).toMatchObject({ _tag: "Some", value: { outcome: "cancelled" } });
			});
		},
	);
	it.effect("persisted acceptance time counts toward setup deadline", () => {
		const opened = Effect.runSync(Deferred.make<void>());
		let signal = new AbortController().signal;
		let writes = 0;
		const storage = Layer.succeed(ChatStorage, {
			load: Effect.succeed(Option.none()),
			save: () => (++writes === 1 ? Effect.sleep(59999) : Effect.void),
		});
		return Effect.gen(function* () {
			const service = yield* initialize;
			const pending = yield* service.submit("a", input()).pipe(Effect.fork);
			yield* TestClock.adjust(59999);
			const turn = yield* Fiber.join(pending);
			yield* Deferred.await(opened);
			yield* TestClock.adjust(1);
			expect((yield* chunks(turn.events)).at(-1)).toMatchObject({
				outcome: "timedOut",
			});
			expect(signal.aborted).toBe(true);
		}).pipe(
			Effect.provide(
				testLayer(
					{
						open: (value) => {
							signal = value.signal;
							return Deferred.succeed(opened, undefined).pipe(
								Effect.as(Stream.never),
							);
						},
					},
					storage,
				),
			),
		);
	});
	it.effect(
		"clearing active history aborts work and suppresses stale callbacks without recreating records",
		() => {
			const opened = Effect.runSync(Deferred.make<void>());
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				yield* Deferred.await(opened);
				yield* service.clear("a", sid);
				yield* Queue.offerAll(queue, [text("late"), complete]);
				expect((yield* chunks(turn.events)).at(-1)).toMatchObject({
					outcome: "cancelled",
				});
				expect(yield* service.list("a")).toEqual([]);
				expect(
					Either.isLeft(
						yield* Effect.either(service.snapshot("a", sid, tid(1))),
					),
				).toBe(true);
			}).pipe(
				Effect.provide(
					testLayer({
						open: () =>
							Deferred.succeed(opened, undefined).pipe(
								Effect.as(Stream.fromQueue(queue)),
							),
					}),
				),
			);
		},
	);
});

describe("production SDK ChatService cancellation", () => {
	it.effect(
		"aborts an actual pending SDK request at the service deadline",
		() => {
			const started = Effect.runSync(Deferred.make<void>());
			let aborted = false;
			const adapter = makeVercelCompatibleAdapter(
				(_url, init) =>
					new Promise<Response>((_resolve, reject) => {
						const abort = () => {
							aborted = true;
							reject(new DOMException("aborted", "AbortError"));
						};
						if (init?.signal?.aborted) abort();
						else init?.signal?.addEventListener("abort", abort, { once: true });
						Effect.runSync(Deferred.succeed(started, undefined));
					}),
			);
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				yield* Deferred.await(started);
				yield* TestClock.adjust(60000);
				expect((yield* chunks(turn.events)).at(-1)).toMatchObject({
					seq: 0,
					outcome: "timedOut",
					errorCode: "CHAT.RESPONSE.TIMEOUT",
				});
				expect(aborted).toBe(true);
			}).pipe(Effect.provide(testLayer(adapter)));
		},
	);
});

describe("atomic history save cancellation", () => {
	it.effect(
		"aborts upstream while a save is pending, then finalizes cancellation before deletion",
		() => {
			const writeStarted = Effect.runSync(Deferred.make<void>());
			const releaseWrite = Effect.runSync(Deferred.make<void>());
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			const opened = Effect.runSync(Deferred.make<void>());
			let writes = 0;
			let signal = new AbortController().signal;
			const persisted: ChatDocument[] = [];
			const storage = Layer.succeed(ChatStorage, {
				load: Effect.succeed(Option.none()),
				save: (document) =>
					Effect.gen(function* () {
						if (++writes === 2) {
							yield* Deferred.succeed(writeStarted, undefined);
							yield* Deferred.await(releaseWrite);
						}
						persisted.push(document);
					}),
			});
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				yield* Deferred.await(opened);
				yield* Queue.offer(queue, text("pending"));
				yield* Deferred.await(writeStarted);
				const cancellation = yield* service
					.cancel("a", sid, tid(1))
					.pipe(Effect.fork);
				yield* Effect.yieldNow();
				expect(signal.aborted).toBe(true);
				yield* Deferred.succeed(releaseWrite, undefined);
				yield* Fiber.join(cancellation);
				expect(yield* chunks(turn.events)).toMatchObject([
					{ type: "end", seq: 0, outcome: "cancelled" },
				]);
				expect((yield* service.history("a", sid)).turns[0]?.status).toBe(
					"cancelled",
				);
				yield* service.clear("a", sid);
				expect(persisted.at(-1)?.sessions).toEqual([]);
				expect(yield* service.list("a")).toEqual([]);
			}).pipe(
				Effect.provide(
					testLayer(
						{
							open: (value) => {
								signal = value.signal;
								return Deferred.succeed(opened, undefined).pipe(
									Effect.as(Stream.fromQueue(queue)),
								);
							},
						},
						storage,
					),
				),
			);
		},
	);
});

describe("failed durable finalization", () => {
	it.effect(
		"retains one truthful live terminal and snapshot when final disk replacement fails, then repairs on the next save",
		() => {
			let writes = 0;
			let fail = true;
			const cause = new Error("secret storage input");
			const storage = Layer.succeed(ChatStorage, {
				load: Effect.succeed(Option.none()),
				save: () =>
					++writes === 3 && fail
						? Effect.fail(new ChatStorageFailed(cause))
						: Effect.void,
			});
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				const actual = yield* chunks(turn.events);
				expect(actual.at(-1)).toMatchObject({
					type: "end",
					outcome: "failed",
					errorCode: "CHAT.HISTORY.STORAGE_FAILED",
				});
				const snapshot = yield* service.snapshot("a", sid, tid(1));
				expect(snapshot.terminal).toMatchObject({
					_tag: "Some",
					value: {
						outcome: "failed",
						errorCode: "CHAT.HISTORY.STORAGE_FAILED",
					},
				});
				expect((yield* service.history("a", sid)).turns[0]?.status).toBe(
					"failed",
				);
				expect((yield* service.subscribe("a", sid, tid(1))).snapshot).toEqual(
					snapshot,
				);
				fail = false;
				yield* chunks((yield* service.submit("a", input(2))).events);
				expect(
					(yield* service.history("a", sid)).turns.map((turn) => turn.status),
				).toEqual(["failed", "completed"]);
				expect(JSON.stringify(snapshot)).not.toContain("secret");
			}).pipe(
				Effect.provide(
					testLayer(
						{
							open: () =>
								Effect.succeed(Stream.make(text("partial"), complete)),
						},
						storage,
					),
				),
			);
		},
	);
});

describe("bounded provider output", () => {
	for (const usage of ["absent", "estimated"] as const) {
		it.effect(
			`keeps long replies with ${usage} usage completed and eligible for context`,
			() => {
				const answer = "界".repeat(800);
				const requests: InferenceRequest[] = [];
				return Effect.gen(function* () {
					const service = yield* initialize;
					const turn = yield* service.submit(
						"a",
						input(1, { outputReserveTokens: 1024 }),
					);
					const actual = yield* chunks(turn.events);
					expect(actual.at(-1)).toMatchObject({
						type: "end",
						outcome: "completed",
						usage: { provenance: "estimated", outputTokens: 2400 },
					});
					expect((yield* service.history("a", sid)).turns[0]?.status).toBe(
						"completed",
					);
					yield* chunks((yield* service.submit("a", input(2))).events);
					expect(requests[1]?.messages).toContainEqual({
						role: "assistant",
						content: [{ _tag: "text", text: answer }],
					});
				}).pipe(
					Effect.provide(
						testLayer({
							open: (value) => {
								requests.push(value.request);
								return Effect.succeed(
									Stream.fromIterable([
										text(answer),
										...(usage === "estimated"
											? [
													{
														_tag: "usage" as const,
														usage: {
															inputTokens: 12,
															outputTokens: 2400,
															provenance: "estimated" as const,
														},
													},
												]
											: []),
										complete,
									]),
								);
							},
						}),
					),
				);
			},
		);
	}
	it.effect(
		"coalesces frequent deltas by time and bytes while preserving live snapshots and terminal durability",
		() => {
			const store = memory();
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			return Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				const received: ChatChunk[] = [];
				const first = yield* Deferred.make<void>();
				const burst = yield* Deferred.make<void>();
				const timed = yield* Deferred.make<void>();
				const sized = yield* Deferred.make<void>();
				const consumer = yield* Stream.runForEach(turn.events, (chunk) =>
					Effect.gen(function* () {
						received.push(chunk);
						if (chunk.seq === 0) yield* Deferred.succeed(first, undefined);
						if (chunk.seq === 100) yield* Deferred.succeed(burst, undefined);
						if (chunk.seq === 101) yield* Deferred.succeed(timed, undefined);
						if (chunk.seq === 102) yield* Deferred.succeed(sized, undefined);
					}),
				).pipe(Effect.fork);
				yield* Queue.offer(queue, text("x"));
				yield* Deferred.await(first);
				expect(store.writes).toHaveLength(2);
				yield* Queue.offerAll(
					queue,
					Array.from({ length: 100 }, () => text("x")),
				);
				yield* Deferred.await(burst);
				expect(store.writes).toHaveLength(2);
				expect((yield* service.snapshot("a", sid, tid(1))).text).toHaveLength(
					101,
				);
				yield* TestClock.adjust(1000);
				yield* Queue.offer(queue, text("y"));
				yield* Deferred.await(timed);
				expect(store.writes).toHaveLength(3);
				yield* Queue.offer(queue, text("z".repeat(4096)));
				yield* Deferred.await(sized);
				expect(store.writes).toHaveLength(4);
				yield* Queue.offerAll(queue, [text("tail"), complete]);
				yield* Fiber.join(consumer);
				expect(store.writes).toHaveLength(5);
				expect(store.writes.at(-1)?.sessions[0]?.turns[0]).toMatchObject({
					status: "completed",
					snapshot: { text: `${"x".repeat(101)}y${"z".repeat(4096)}tail` },
				});
				expect(received.at(-1)).toMatchObject({
					type: "end",
					outcome: "completed",
				});
			}).pipe(
				Effect.provide(
					testLayer(
						{ open: () => Effect.succeed(Stream.fromQueue(queue)) },
						store.layer,
					),
				),
			);
		},
	);
	it.effect(
		"keeps reported usage distinct when a provider exceeds the output reserve",
		() =>
			Effect.gen(function* () {
				const service = yield* initialize;
				const turn = yield* service.submit("a", input());
				const actual = yield* chunks(turn.events);
				expect(actual.at(-1)).toMatchObject({
					type: "end",
					outcome: "failed",
					errorCode: "CHAT.LIMIT.EXCEEDED",
					usage: { outputTokens: 2048, provenance: "reported" },
				});
				expect((yield* service.history("a", sid)).turns[0]?.status).toBe(
					"failed",
				);
			}).pipe(
				Effect.provide(
					testLayer({
						open: () =>
							Effect.succeed(
								Stream.make(
									text("answer"),
									{
										_tag: "usage" as const,
										usage: {
											inputTokens: 12,
											outputTokens: 2048,
											provenance: "reported" as const,
										},
									},
									complete,
								),
							),
					}),
				),
			),
	);
});

for (const finishAt of [90000, 300000])
	it.effect(
		`media turns use the selected transport budget at ${finishAt}ms`,
		() => {
			const queue = Effect.runSync(Queue.unbounded<NormalizedEvent>());
			const opened = Effect.runSync(Deferred.make<void>());
			let signal: AbortSignal | undefined;
			return Effect.gen(function* () {
				yield* AiRepository.put({
					...workflowProfile,
					adapter: "dashscope-media",
					settings: { mediaKind: "image" },
					capabilities: {
						...workflowProfile.capabilities,
						imageGeneration: "supported",
					},
				});
				const service = yield* ChatService;
				const turn = yield* service.submit("window-a", input());
				const consumer = yield* chunks(turn.events).pipe(Effect.fork);
				yield* Deferred.await(opened);
				yield* TestClock.adjust(finishAt === 300000 ? 299999 : finishAt);
				expect(signal?.aborted).toBe(false);
				if (finishAt === 300000) yield* TestClock.adjust(1);
				if (finishAt < 300000) {
					expect(signal?.aborted).toBe(false);
					yield* Queue.offerAll(queue, [
						text("https://result.invalid/image.png"),
						complete,
					]);
				}
				const events = yield* Fiber.join(consumer);
				expect(events.at(-1)).toMatchObject(
					finishAt < 300000
						? { outcome: "completed" }
						: { outcome: "timedOut", errorCode: "CHAT.RESPONSE.TIMEOUT" },
				);
				expect(events.filter((event) => event.type === "end")).toHaveLength(1);
				expect(signal?.aborted).toBe(true);
			}).pipe(
				Effect.provide(
					testLayer({
						open: (value) => {
							signal = value.signal;
							return Deferred.succeed(opened, undefined).pipe(
								Effect.as(Stream.fromQueue(queue)),
							);
						},
					}),
				),
			);
		},
	);

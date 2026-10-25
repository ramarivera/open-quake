import { Chunk, Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
	type ConversationResolution,
	ConversationRuntimePort,
	ConversationService,
} from "./conversation-service.js";
import type {
	RuntimeConversationEvent,
	RuntimeKind,
} from "./runtime-contracts.js";
import { RuntimeCapabilityUnsupported } from "./runtime-errors.js";
import type { RuntimeProviderAdapter } from "./runtime-ports.js";

const request = {
	connectionId: "connection",
	requestId: "request-1",
	text: "hello",
};
const scope = { connectionId: "connection", sessionId: "request-1" };
const text = {
	_tag: "textDelta",
	textDelta: "answer",
	kind: "generation",
} as const;
const done = { _tag: "completed", sessionId: "provider-session" } as const;
function provider(
	kind: RuntimeKind,
	streamConversation: RuntimeProviderAdapter["streamConversation"],
): RuntimeProviderAdapter {
	return {
		kind,
		streamConversation,
		health: () =>
			Effect.succeed({ status: "ready", lifecycle: "externallyManaged" }),
		capabilities: () =>
			Effect.succeed({
				health: "supported",
				chat: "supported",
				listAgents: "unsupported",
				sessions: "unsupported",
				resources: "unsupported",
				models: "unsupported",
				toolEvents: "unverified",
				usage: "unverified",
			}),
		listAgents: () => Effect.fail(new RuntimeCapabilityUnsupported()),
	};
}
function runtime(
	adapter: RuntimeProviderAdapter,
	baseURL = "http://localhost:1",
	resolve?: () => ConversationResolution,
) {
	return ManagedRuntime.make(
		ConversationService.Default.pipe(
			Layer.provide(
				Layer.succeed(ConversationRuntimePort, {
					resolve: () =>
						Effect.sync(
							() =>
								resolve?.() ?? {
									connection: {
										id: "connection",
										name: "fixture",
										kind: adapter.kind,
										baseURL,
									},
									adapter,
								},
						),
				}),
			),
		),
	);
}
const collect = (
	service: ConversationService,
	owner = "owner",
	input: unknown = request,
) =>
	service
		.stream(owner, input)
		.pipe(Stream.runCollect, Effect.map(Chunk.toReadonlyArray));

describe("conversation service", () => {
	it("doesn't release another request's active session after a busy rejection", async () => {
		let accepted!: () => void;
		const ready = new Promise<void>((resolve) => {
			accepted = resolve;
		});
		const app = runtime(
			provider("hermes", () => Stream.concat(Stream.make(text), Stream.never)),
		);
		try {
			const fiber = app.runFork(
				Effect.flatMap(ConversationService, (service) =>
					service
						.stream("owner", request)
						.pipe(Stream.runForEach(() => Effect.sync(accepted))),
				),
			);
			await ready;
			const rejected = await app.runPromise(
				Effect.flatMap(ConversationService, (service) =>
					collect(service, "owner", {
						...request,
						requestId: "competing",
						sessionId: "request-1",
					}),
				),
			);
			expect(rejected.at(-1)).toMatchObject({
				outcome: "failed",
				errorCode: "AGENT.HTTP.REQUEST.FAILED",
			});
			expect(
				(await app.runPromise(ConversationService.history("owner", scope)))[0]
					?.turns[0]?.outcome,
			).toBe("processing");
			expect(
				(
					await app.runPromise(
						ConversationService.clear("owner", scope).pipe(Effect.either),
					)
				)._tag,
			).toBe("Left");
			await app.runPromise(
				ConversationService.cancel("owner", request.requestId),
			);
			await app.runPromise(Fiber.join(fiber));
		} finally {
			await app.dispose();
		}
	});
	it("bounds aggregate text and event counts independently of the provider", async () => {
		for (const events of [
			[
				{ ...text, textDelta: "x".repeat(40000) },
				{ ...text, textDelta: "y".repeat(40000) },
			],
			Array.from({ length: 8193 }, () => ({
				_tag: "status" as const,
				kind: "thinking",
				text: "waiting",
			})),
		]) {
			const app = runtime(
				provider("hermes", () =>
					Stream.fromIterable<RuntimeConversationEvent>(events),
				),
			);
			try {
				const output = await app.runPromise(
					Effect.flatMap(ConversationService, (service) => collect(service)),
				);
				expect(output.at(-1)).toMatchObject({
					outcome: "failed",
					errorCode: "AGENT.HTTP.RESPONSE.LIMIT_EXCEEDED",
				});
			} finally {
				await app.dispose();
			}
		}
	});
	it("rejects cross-owner, cross-runtime, changed endpoint and changed agent session reuse before dispatch", async () => {
		let calls = 0;
		const adapter = provider("openclaw", () => {
			calls++;
			return Stream.make(text, done);
		});
		let connection = {
			id: "connection",
			kind: "openclaw" as const,
			name: "test",
			baseURL: "http://localhost:1",
			credentialRef: "ref-1",
		};
		const app = runtime(adapter, undefined, () => ({ connection, adapter }));
		try {
			await app.runPromise(
				Effect.flatMap(ConversationService, (service) => collect(service)),
			);
			for (const [owner, input] of [
				["other", { ...request, requestId: "owner", sessionId: "request-1" }],
				[
					"owner",
					{
						...request,
						requestId: "agent",
						sessionId: "request-1",
						agentId: "other",
					},
				],
				[
					"owner",
					{
						...request,
						requestId: "runtime",
						connectionId: "other",
						sessionId: "request-1",
					},
				],
			] as const) {
				const events = await app.runPromise(
					Effect.flatMap(ConversationService, (service) =>
						collect(service, owner, input),
					),
				);
				expect(events.at(-1)).toMatchObject({
					outcome: "failed",
					errorCode: "AGENT.HTTP.CONNECTION.INVALID",
				});
			}
			connection = {
				...connection,
				baseURL: "http://localhost:2",
				credentialRef: "ref-2",
			};
			const events = await app.runPromise(
				Effect.flatMap(ConversationService, (service) =>
					collect(service, "owner", {
						...request,
						requestId: "endpoint",
						sessionId: "request-1",
					}),
				),
			);
			expect(events.at(-1)).toMatchObject({
				errorCode: "AGENT.HTTP.CONNECTION.INVALID",
			});
			expect(calls).toBe(1);
		} finally {
			await app.dispose();
		}
	});
	it.each([
		["missing completion", [text], "AGENT.HTTP.PROTOCOL.INVALID"],
		["duplicate completion", [done, done], "AGENT.HTTP.PROTOCOL.INVALID"],
		[
			"oversized event",
			[{ ...text, textDelta: "x".repeat(65537) }],
			"AGENT.HTTP.RESPONSE.LIMIT_EXCEEDED",
		],
	] as const)(
		"rejects %s without inventing successful completion",
		async (_label, events, code) => {
			const app = runtime(
				provider("hermes", () =>
					Stream.fromIterable<RuntimeConversationEvent>(events),
				),
			);
			try {
				const output = await app.runPromise(
					Effect.flatMap(ConversationService, (service) => collect(service)),
				);
				expect(output.at(-1)).toMatchObject({
					outcome: "failed",
					errorCode: code,
				});
			} finally {
				await app.dispose();
			}
		},
	);
	it("shutdown interrupts in-flight work and prevents new provider dispatch", async () => {
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		let released = false;
		const app = runtime(
			provider("hermes", () =>
				Stream.unwrapScoped(
					Effect.acquireRelease(
						Effect.sync(() => {
							started();
							return Stream.never;
						}),
						() =>
							Effect.sync(() => {
								released = true;
							}),
					),
				),
			),
		);
		try {
			const fiber = app.runFork(
				Effect.flatMap(ConversationService, (service) =>
					service.stream("voice", request).pipe(Stream.runDrain),
				),
			);
			await ready;
			await app.runPromise(ConversationService.shutdown());
			await app.runPromise(Fiber.join(fiber));
			expect(released).toBe(true);
			const rejected = await app.runPromise(
				Effect.flatMap(ConversationService, (service) =>
					collect(service, "voice", { ...request, requestId: "new" }),
				).pipe(Effect.either),
			);
			expect(rejected._tag).toBe("Left");
		} finally {
			await app.dispose();
		}
	});
});

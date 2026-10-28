import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Stream,
	TestClock,
} from "effect";
import type {
	RuntimeCapabilities,
	RuntimeConversationEvent,
	RuntimeConversationRequest,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import { RuntimeAuthenticationFailed } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";
import type { AgentState } from "../../../../../packages/edge/src/agents/agents-contracts.js";
import { AgentDraftFailed } from "../../../../../packages/edge/src/agents/agents-errors.js";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants.js";
import {
	AgentDraftPort,
	AgentRuntimePort,
} from "../../../../../packages/edge/src/agents/agents-ports.js";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository.js";
import { AgentsRuntime } from "../../../../../packages/edge/src/agents/agents-runtime.js";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service.js";
import {
	createAgentDraftAdapter,
	createAgentRuntimeAdapter,
	type RuntimeDraftSelection,
} from "./management-adapter.js";
import {
	createRuntimeRegistry,
	type RuntimeResolver,
} from "./runtime-registry.js";

const capabilities: RuntimeCapabilities = {
	health: "supported",
	chat: "supported",
	listAgents: "unsupported",
	sessions: "unsupported",
	resources: "unsupported",
	models: "unsupported",
	toolEvents: "unsupported",
	usage: "unsupported",
};
function fixture() {
	const requests: RuntimeConversationRequest[] = [];
	let selected: RuntimeDraftSelection | undefined = {
		connectionId: "external",
		agentId: "provider/remote:1",
	};
	let output =
		'{"IDENTITY.md":"# Identity","SOUL.md":"# Remote draft","AGENTS.md":"# Rules"}';
	let chat: RuntimeCapabilities["chat"] = "supported";
	let closed = 0;
	let stream:
		| (() => Stream.Stream<
				RuntimeConversationEvent,
				RuntimeAuthenticationFailed
		  >)
		| undefined;
	const adapter: RuntimeProviderAdapter = {
		kind: "hermes",
		health: () =>
			Effect.succeed({ status: "ready", lifecycle: "externallyManaged" }),
		capabilities: () => Effect.succeed({ ...capabilities, chat }),
		listAgents: () => Effect.succeed([]),
		streamConversation: (_connection, request) =>
			Stream.suspend(() => {
				requests.push(request);
				return (
					stream
						? stream()
						: Stream.fromIterable<RuntimeConversationEvent>([
								{ _tag: "textDelta", kind: "generation", textDelta: output },
								{ _tag: "completed" },
							])
				).pipe(
					Stream.ensuring(
						Effect.sync(() => {
							closed++;
						}),
					),
				);
			}),
	};
	const resolve: RuntimeResolver = (id) =>
		Effect.succeed({
			connection: {
				id,
				name: "External",
				kind: "hermes",
				baseURL: "http://fixture.test",
			},
			adapter,
		});
	const drafting = createAgentDraftAdapter({
		resolve,
		selected: () => Effect.sync(() => selected),
	});
	return {
		resolve,
		drafting,
		requests,
		closed: () => closed,
		select: (next: RuntimeDraftSelection | undefined) => {
			selected = next;
		},
		output: (next: string) => {
			output = next;
		},
		chat: (next: RuntimeCapabilities["chat"]) => {
			chat = next;
		},
		stream: (
			next: () => Stream.Stream<
				RuntimeConversationEvent,
				RuntimeAuthenticationFailed
			>,
		) => {
			stream = next;
		},
	};
}
describe("management HTTP adapters through existing consumers", () => {
	it.effect(
		"disables legacy process actions even while HTTP is connected",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = fixture();
					const registry = yield* createRuntimeRegistry({ resolve: f.resolve });
					yield* registry.connect("external");
					const backend = createAgentRuntimeAdapter();
					expect(backend.initial).toMatchObject({
						available: false,
						status: "stopped",
						code: "AGENT.RUNTIME.UNAVAILABLE",
					});
					yield* Effect.gen(function* () {
						const service = yield* AgentsRuntime;
						for (const action of ["start", "stop", "restart"] as const) {
							const result = yield* service.control(action).pipe(Effect.either);
							expect(result._tag === "Left" && result.left.code).toBe(
								"AGENT.RUNTIME.UNAVAILABLE",
							);
						}
						expect((yield* service.read()).available).toBe(false);
					}).pipe(
						Effect.provide(
							AgentsRuntime.Default.pipe(
								Layer.provide(Layer.succeed(AgentRuntimePort, backend)),
							),
						),
					);
					expect((yield* registry.read()).status).toBe("connected");
					expect(f.requests).toHaveLength(0);
					for (const action of ["start", "stop", "restart"] as const) {
						const result = yield* backend[action].pipe(Effect.either);
						expect(result._tag === "Left" && result.left.code).toBe(
							"AGENT.RUNTIME.UNAVAILABLE",
						);
					}
				}),
			),
	);
	it.effect(
		"drafts through the saved external selection while preserving local workspaces and remote ids",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const f = fixture();
					let stored: AgentState = initialAgentState();
					yield* Effect.gen(function* () {
						const service = yield* AgentsService;
						const created = yield* service.request({
							type: "create",
							id: "local-researcher",
							name: "Local researcher",
							emoji: "R",
						});
						const generated = yield* service.request({
							type: "draft-agent",
							id: "local-researcher",
							prompt: "Research carefully",
							revision: created.view.revision,
						});
						expect(
							generated.view.agents.find((a) => a.id === "local-researcher")
								?.files["SOUL.md"],
						).toBe("# Remote draft");
						expect(generated.view.agents.map((a) => a.id)).toEqual([
							"main",
							"local-researcher",
						]);
						expect(f.requests[0]).toMatchObject({
							connectionId: "external",
							agentId: "provider/remote:1",
						});
						expect(f.requests[0]?.agentId).not.toBe("local-researcher");
						expect(f.closed()).toBe(1);
						f.output(
							"---\nname: Research\ndescription: Find sources\n---\n\nCite sources.",
						);
						const skill = yield* service.request({
							type: "draft-skill",
							name: "Research",
							prompt: "Find sources",
						});
						expect(skill.draft).toContain("Cite sources.");
						expect(stored.skills).toHaveLength(0);
					}).pipe(
						Effect.provide(
							AgentsService.Default.pipe(
								Layer.provide(
									Layer.mergeAll(
										Layer.succeed(
											AgentRuntimePort,
											createAgentRuntimeAdapter(),
										),
										Layer.succeed(AgentDraftPort, f.drafting),
										Layer.succeed(AgentStorage, {
											read: () => Effect.sync(() => Option.some(stored)),
											write: (next) =>
												Effect.sync(() => {
													stored = next;
												}),
										}),
									),
								),
							),
						),
					);
					expect(f.requests).toHaveLength(2);
				}),
			),
	);
	it.effect(
		"uses the documented default when selection has no remote agent id",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				f.select({ connectionId: "external" });
				yield* f.drafting.skill({ name: "Research", prompt: "Sources" });
				expect(f.requests[0]).not.toHaveProperty("agentId");
				expect(f.requests[0]).not.toHaveProperty("sessionId");
			}),
	);
	it.effect(
		"rejects absent selections and unsupported/unverified chat without starting a stream",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				f.select(undefined);
				const absent = yield* f.drafting
					.skill({ name: "A", prompt: "B" })
					.pipe(Effect.either);
				expect(absent._tag === "Left" && absent.left.code).toBe(
					"AGENT.DRAFT.UNAVAILABLE",
				);
				f.select({ connectionId: "external" });
				for (const status of ["unsupported", "unverified"] as const) {
					f.chat(status);
					const result = yield* f.drafting
						.skill({ name: "A", prompt: "B" })
						.pipe(Effect.either);
					expect(result._tag === "Left" && result.left.code).toBe(
						"AGENT.DRAFT.UNAVAILABLE",
					);
				}
				expect(f.requests).toHaveLength(0);
			}),
	);
	it.effect(
		"rejects malformed, incomplete and oversized generations, closing every stream",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const local = initialAgentState().agents[0];
				if (!local) return yield* new AgentDraftFailed();
				for (const output of [
					"process.exit(1)",
					'{"SOUL.md":"missing required files"}',
					"x".repeat(786433),
				]) {
					f.output(output);
					const result = yield* f.drafting
						.agent({ agent: local, prompt: "Draft" })
						.pipe(Effect.either);
					expect(result._tag === "Left" && result.left.code).toBe(
						"AGENT.DRAFT.FAILED",
					);
				}
				f.stream(() =>
					Stream.fromIterable<RuntimeConversationEvent>([
						{
							_tag: "textDelta",
							kind: "generation",
							textDelta: "partial",
						},
					]),
				);
				const partial = yield* f.drafting
					.skill({ name: "A", prompt: "B" })
					.pipe(Effect.either);
				expect(partial._tag === "Left" && partial.left.code).toBe(
					"AGENT.DRAFT.FAILED",
				);
				expect(f.closed()).toBe(4);
			}),
	);
	it.effect("retains scrubbed provider cause at the draft boundary", () =>
		Effect.gen(function* () {
			const f = fixture();
			const cause = new RuntimeAuthenticationFailed(
				new Error("Bearer private-token"),
			);
			f.stream(() => Stream.fail(cause));
			const result = yield* f.drafting
				.skill({ name: "A", prompt: "B" })
				.pipe(Effect.either);
			expect(result._tag === "Left" && result.left._tag).toBe(
				"AgentDraftFailed",
			);
			if (result._tag === "Left" && result.left instanceof AgentDraftFailed) {
				expect(result.left.originalCause).toBeInstanceOf(
					RuntimeAuthenticationFailed,
				);
				expect(JSON.stringify(result.left)).not.toContain("private-token");
			}
			expect(f.closed()).toBe(1);
		}),
	);
	it.effect("interrupting a draft cancels its provider stream", () =>
		Effect.gen(function* () {
			const f = fixture();
			const entered = yield* Deferred.make<void>();
			f.stream(() =>
				Stream.fromEffect(
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
					),
				),
			);
			const call = yield* f.drafting
				.skill({ name: "A", prompt: "B" })
				.pipe(Effect.fork);
			yield* Deferred.await(entered);
			yield* Fiber.interrupt(call);
			expect(f.closed()).toBe(1);
		}),
	);
	it.effect("times out and closes a stalled draft", () =>
		Effect.gen(function* () {
			const f = fixture();
			const entered = yield* Deferred.make<void>();
			f.stream(() =>
				Stream.fromEffect(
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
					),
				),
			);
			const call = yield* f.drafting
				.skill({ name: "A", prompt: "B" })
				.pipe(Effect.either, Effect.fork);
			yield* Deferred.await(entered);
			yield* TestClock.adjust("60 seconds");
			const result = yield* Fiber.join(call);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.DRAFT.FAILED",
			);
			expect(f.closed()).toBe(1);
		}),
	);
	it.effect("bounds selection lookup before a draft stream starts", () =>
		Effect.gen(function* () {
			const f = fixture();
			const entered = yield* Deferred.make<void>();
			let interrupted = false;
			const drafts = createAgentDraftAdapter({
				resolve: f.resolve,
				selected: () =>
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								interrupted = true;
							}),
						),
					),
			});
			const call = yield* drafts
				.skill({ name: "A", prompt: "B" })
				.pipe(Effect.either, Effect.fork);
			yield* Deferred.await(entered);
			yield* TestClock.adjust("60 seconds");
			const result = yield* Fiber.join(call);
			expect(result._tag === "Left" && result.left.code).toBe(
				"AGENT.DRAFT.FAILED",
			);
			expect(interrupted).toBe(true);
			expect(f.requests).toHaveLength(0);
		}),
	);
});

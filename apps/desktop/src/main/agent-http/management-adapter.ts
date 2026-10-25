import { randomUUID } from "node:crypto";
import { Effect, Schema, Stream } from "effect";
import type { RuntimeConversationRequest } from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeCapabilityUnsupported,
	type RuntimeError,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import {
	type Agent,
	Content,
} from "../../../../../packages/edge/src/agents/agents-contracts.js";
import {
	AgentDraftFailed,
	AgentDraftUnavailable,
	type AgentError,
	AgentRuntimeFailed,
} from "../../../../../packages/edge/src/agents/agents-errors.js";
import type {
	AgentDraftAdapter,
	AgentRuntimeAdapter,
} from "../../../../../packages/edge/src/agents/agents-ports.js";
import type { RuntimeRegistry, RuntimeResolver } from "./runtime-registry.js";

/** available gates legacy process buttons. It doesn't describe HTTP connectivity.
 * The connection UI consumes registry.read/subscribe and connect/disconnect/refresh.
 */
export function createAgentRuntimeAdapter(
	registry: RuntimeRegistry,
): AgentRuntimeAdapter {
	const initial = {
		available: false,
		status: "error" as const,
		code: new RuntimeCapabilityUnsupported().code,
		operation: "none" as const,
	};
	return {
		available: false,
		initial,
		start: Effect.fail(
			new AgentRuntimeFailed(new RuntimeCapabilityUnsupported()),
		),
		stop: Effect.fail(
			new AgentRuntimeFailed(new RuntimeCapabilityUnsupported()),
		),
		restart: Effect.fail(
			new AgentRuntimeFailed(new RuntimeCapabilityUnsupported()),
		),
		subscribe: (listener) =>
			registry.subscribe((snapshot) =>
				listener({
					...initial,
					status: snapshot.status === "connected" ? "ready" : "error",
					code: snapshot.code ?? initial.code,
				}),
			),
	};
}
export interface RuntimeDraftSelection {
	readonly connectionId: string;
	/** Opaque remote id. Never inferred from a local Agent or panel slot. */
	readonly agentId?: string;
}
export interface RuntimeDraftOptions {
	readonly resolve: RuntimeResolver;
	readonly selected: () => Effect.Effect<
		RuntimeDraftSelection | undefined,
		RuntimeError
	>;
}
const DraftFiles = Schema.Struct({
	"IDENTITY.md": Content,
	"SOUL.md": Content,
	"AGENTS.md": Content,
});

/** Generates a local preview. It has no remote resource mutation operation. */
export function createAgentDraftAdapter(
	options: RuntimeDraftOptions,
): AgentDraftAdapter {
	const text = Effect.fn("AgentHttp.draftText")(function* (
		prompt: string,
	): Effect.fn.Return<string, AgentError> {
		const selected = yield* options
			.selected()
			.pipe(Effect.mapError((cause) => new AgentDraftFailed(cause)));
		if (!selected) return yield* new AgentDraftUnavailable();
		const { connection, adapter } = yield* options
			.resolve(selected.connectionId)
			.pipe(Effect.mapError((cause) => new AgentDraftFailed(cause)));
		const capabilities = yield* adapter
			.capabilities(connection)
			.pipe(Effect.mapError((cause) => new AgentDraftFailed(cause)));
		if (capabilities.chat !== "supported")
			return yield* new AgentDraftUnavailable();
		const request: RuntimeConversationRequest = {
			connectionId: connection.id,
			conversationId: randomUUID(),
			...(selected.agentId ? { agentId: selected.agentId } : {}),
			messages: [{ role: "user", content: prompt }],
		};
		const result = yield* adapter.streamConversation(connection, request).pipe(
			Stream.takeUntil((event) => event._tag === "completed"),
			Stream.runFoldEffect({ text: "", completed: false }, (state, event) => {
				const content =
					event._tag === "textDelta"
						? state.text + event.textDelta
						: state.text;
				return content.length > 786432
					? Effect.fail(new AgentDraftFailed())
					: Effect.succeed({
							text: content,
							completed: state.completed || event._tag === "completed",
						});
			}),
			Effect.mapError((cause) => new AgentDraftFailed(cause)),
			Effect.timeoutFail({
				duration: "60 seconds",
				onTimeout: () => new AgentDraftFailed(),
			}),
		);
		if (!result.completed) return yield* new AgentDraftFailed();
		return result.text;
	});
	return {
		agent: Effect.fn("AgentHttp.draftAgent")(function* ({
			agent,
			prompt,
		}: {
			readonly agent: Agent;
			readonly prompt: string;
		}): Effect.fn.Return<Readonly<Record<string, string>>, AgentError> {
			const output = yield* text(
				`Draft workspace Markdown for ${agent.name}. Return only a JSON object with file names IDENTITY.md, SOUL.md and AGENTS.md and Markdown string values. Do not include credentials.\n\n${prompt}`,
			);
			return yield* Schema.decodeUnknown(Schema.parseJson(DraftFiles))(
				output,
			).pipe(
				Effect.catchTag("ParseError", (cause) =>
					Effect.fail(new AgentDraftFailed(cause)),
				),
			);
		}),
		skill: Effect.fn("AgentHttp.draftSkill")(function* ({
			name,
			prompt,
		}: {
			readonly name: string;
			readonly prompt: string;
		}): Effect.fn.Return<string, AgentError> {
			const output = yield* text(
				`Draft SKILL.md Markdown only, starting with YAML front matter containing name: ${name} and description:. Do not include credentials.\n\n${prompt}`,
			);
			return yield* Schema.decodeUnknown(Content)(output).pipe(
				Effect.catchTag("ParseError", (cause) =>
					Effect.fail(new AgentDraftFailed(cause)),
				),
			);
		}),
	};
}

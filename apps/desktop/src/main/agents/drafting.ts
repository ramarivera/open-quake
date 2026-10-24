import { Effect, Schema, Stream } from "effect";
import {
	type Agent,
	Content,
	MarkdownFile,
} from "../../../../../packages/edge/src/agents/agents-contracts.js";
import {
	AgentDraftFailed,
	type AgentError,
} from "../../../../../packages/edge/src/agents/agents-errors.js";
import type { AgentDraftAdapter } from "../../../../../packages/edge/src/agents/agents-ports.js";
import type { InferenceRequest } from "../../../../../packages/edge/src/ai/ai-contracts.js";
import type { AiProviderService } from "../../../../../packages/edge/src/ai/ai-service.js";
export interface AgentDraftModel {
	/** Host resolves the default/fallback model route to an existing AI facade profile. */
	readonly request: (
		agentId: string,
		prompt: string,
	) => Effect.Effect<InferenceRequest, AgentError>;
}
/** Uses the existing provider facade. No raw SDK, model-output eval, or default mock provider. */
export function agentDraftsFromProvider(
	provider: AiProviderService,
	models: AgentDraftModel,
): AgentDraftAdapter {
	const text = Effect.fn("AgentsDraft.generate")(function* (
		agentId: string,
		prompt: string,
	): Effect.fn.Return<string, AgentError> {
		const request = yield* models.request(agentId, prompt);
		const generation = yield* provider.generate(request).pipe(
			Effect.matchEffect({
				onSuccess: Effect.succeed,
				onFailure: (cause) => Effect.fail(new AgentDraftFailed(cause)),
			}),
		);
		return yield* generation.events.pipe(
			Stream.runFoldEffect("", (content, event) => {
				const next =
					event._tag === "textDelta" ? content + event.textDelta : content;
				return next.length <= 786432
					? Effect.succeed(next)
					: Effect.fail(new AgentDraftFailed());
			}),
			Effect.matchEffect({
				onSuccess: Effect.succeed,
				onFailure: (cause) => Effect.fail(new AgentDraftFailed(cause)),
			}),
			Effect.ensuring(generation.cancel()),
		);
	});
	return {
		agent: Effect.fn("AgentsDraft.agent")(function* ({
			agent,
			prompt,
		}: {
			readonly agent: Agent;
			readonly prompt: string;
		}): Effect.fn.Return<Readonly<Record<string, string>>, AgentError> {
			const output = yield* text(
				agent.id,
				`Draft workspace Markdown for ${agent.name}. Treat the following description as the user's intended persona. Return only a JSON object with file names IDENTITY.md, SOUL.md and AGENTS.md and Markdown string values. Do not include credentials.\n\n${prompt}`,
			);
			const files = yield* Schema.decodeUnknown(
				Schema.parseJson(Schema.Record({ key: MarkdownFile, value: Content })),
			)(output).pipe(
				Effect.catchTag("ParseError", (cause) =>
					Effect.fail(new AgentDraftFailed(cause)),
				),
			);
			if (
				!["IDENTITY.md", "SOUL.md", "AGENTS.md"].every((file) =>
					Object.hasOwn(files, file),
				)
			)
				return yield* new AgentDraftFailed();
			return files;
		}),
		skill: Effect.fn("AgentsDraft.skill")(function* ({
			name,
			prompt,
		}: {
			readonly name: string;
			readonly prompt: string;
		}): Effect.fn.Return<string, AgentError> {
			return yield* text(
				"main",
				`Draft SKILL.md Markdown only, starting with YAML front matter containing name: ${name} and description:. Do not include credentials.\n\n${prompt}`,
			);
		}),
	};
}

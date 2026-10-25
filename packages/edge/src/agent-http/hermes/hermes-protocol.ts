import { Effect, Schema } from "effect";
import type { RuntimeConversationEvent } from "../runtime-contracts.js";
import {
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
} from "../runtime-errors.js";

const Identifier = Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256));
const Count = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
export const HermesCapabilities = Schema.Struct({
	object: Schema.Literal("hermes.api_server.capabilities"),
	platform: Schema.Literal("hermes-agent"),
	model: Identifier,
	features: Schema.Struct({
		chat_completions: Schema.optional(Schema.Boolean),
		chat_completions_streaming: Schema.optional(Schema.Boolean),
		tool_progress_events: Schema.optional(Schema.Boolean),
	}),
});
export const HermesHealth = Schema.Struct({
	platform: Schema.Literal("hermes-agent"),
	status: Schema.Literal("ok", "degraded"),
});
export const HermesModels = Schema.Struct({
	object: Schema.Literal("list"),
	data: Schema.Array(
		Schema.Struct({ id: Identifier, object: Schema.Literal("model") }),
	).pipe(Schema.maxItems(256)),
});
const Chunk = Schema.Struct({
	object: Schema.Literal("chat.completion.chunk"),
	choices: Schema.Array(
		Schema.Struct({
			index: Schema.Literal(0),
			delta: Schema.Struct({
				content: Schema.optional(Schema.NullOr(Schema.String)),
			}),
			finish_reason: Schema.NullOr(Schema.String),
		}),
	).pipe(Schema.itemsCount(1)),
	usage: Schema.optional(
		Schema.Struct({ prompt_tokens: Count, completion_tokens: Count }),
	),
	error: Schema.optional(Schema.Unknown),
	hermes: Schema.optional(
		Schema.Struct({
			failed: Schema.optional(Schema.Boolean),
			partial: Schema.optional(Schema.Boolean),
			completed: Schema.optional(Schema.Boolean),
		}),
	),
});
const Status = Schema.Struct({ kind: Schema.String, text: Schema.String });
const Tool = Schema.Struct({
	tool: Schema.String,
	toolCallId: Identifier,
	status: Schema.Literal("running", "completed"),
	label: Schema.optional(Schema.String),
});

/** Installed Hermes 0.21.3 api_server_openai_routes.py:817-887. */
export interface HermesStreamState {
	finished: boolean;
	done: boolean;
}

export const isHermesDone = (frame: {
	readonly event: string;
	readonly data: string;
}): boolean =>
	(frame.event === "message" || frame.event === "") && frame.data === "[DONE]";

export const decodeHermes = <A, I>(
	schema: Schema.Schema<A, I>,
	value: unknown,
): Effect.Effect<A, RuntimeProtocolInvalid> =>
	Schema.decodeUnknown(schema)(value).pipe(
		Effect.mapError((cause) => new RuntimeProtocolInvalid(cause)),
	);

export const decodeHermesFrame: (
	frame: { readonly event: string; readonly data: string },
	state: HermesStreamState,
) => Effect.Effect<
	readonly RuntimeConversationEvent[],
	RuntimeProtocolInvalid | RuntimeRequestFailed
> = Effect.fn("Hermes.decodeFrame")(function* (
	frame: { readonly event: string; readonly data: string },
	state: HermesStreamState,
) {
	if (isHermesDone(frame)) {
		if (!state.finished || state.done)
			return yield* Effect.fail(new RuntimeProtocolInvalid());
		state.done = true;
		return [];
	}
	// Unknown extension events are not answer content, and may use another encoding.
	if (
		!["message", "", "hermes.status", "hermes.tool.progress"].includes(
			frame.event,
		)
	)
		return [];
	if (state.finished || state.done)
		return yield* Effect.fail(new RuntimeProtocolInvalid());
	const value = yield* Effect.try({
		try: (): unknown => JSON.parse(frame.data),
		catch: (cause) => new RuntimeProtocolInvalid(cause),
	});
	if (frame.event === "hermes.status") {
		const status = yield* decodeHermes(Status, value);
		return [{ _tag: "status", kind: status.kind, text: status.text }];
	}
	if (frame.event === "hermes.tool.progress") {
		const tool = yield* decodeHermes(Tool, value);
		return [
			{
				_tag: "tool",
				toolCallId: tool.toolCallId,
				tool: tool.tool,
				phase: tool.status,
				...(tool.label === undefined ? {} : { label: tool.label }),
			},
		];
	}
	const chunk = yield* decodeHermes(Chunk, value);
	if (
		chunk.error !== undefined ||
		chunk.hermes?.failed ||
		chunk.hermes?.partial ||
		chunk.hermes?.completed === false
	) {
		return yield* Effect.fail(new RuntimeRequestFailed(chunk));
	}
	const choice = chunk.choices[0];
	if (!choice) return yield* Effect.fail(new RuntimeProtocolInvalid());
	if (choice.finish_reason !== null && choice.finish_reason !== "stop")
		return yield* Effect.fail(new RuntimeRequestFailed(chunk));
	const events: RuntimeConversationEvent[] = [];
	if (choice.delta.content)
		events.push({
			_tag: "textDelta",
			textDelta: choice.delta.content,
			kind: "generation",
		});
	if (chunk.usage)
		events.push({
			_tag: "usage",
			usage: {
				inputTokens: chunk.usage.prompt_tokens,
				outputTokens: chunk.usage.completion_tokens,
				provenance: "reported",
			},
		});
	if (choice.finish_reason === "stop") state.finished = true;
	return events;
});

import { Effect, Schema, Stream } from "effect";
import type { RuntimeConversationEvent } from "../runtime-contracts.js";
import {
	type RuntimeError,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
} from "../runtime-errors.js";
import type { RuntimeHttpResponse } from "../runtime-ports.js";
import { parseSse } from "../transport.js";

export type OpenClawProtocol = "responses" | "chatCompletions";
const Count = Schema.Int.pipe(Schema.nonNegative());
const ResponsesUsage = Schema.Struct({
	input_tokens: Count,
	output_tokens: Count,
});
const ChatUsage = Schema.Struct({
	prompt_tokens: Count,
	completion_tokens: Count,
});
const Call = Schema.Struct({
	type: Schema.Literal("function_call"),
	call_id: Schema.NonEmptyString.pipe(Schema.maxLength(256)),
	name: Schema.String,
	arguments: Schema.String.pipe(Schema.maxLength(262144)),
});
const Envelope = Schema.Struct({
	type: Schema.String,
	delta: Schema.optional(Schema.String),
	item: Schema.optional(Schema.Unknown),
	response: Schema.optional(Schema.Unknown),
});
const Resource = Schema.Struct({
	id: Schema.NonEmptyString,
	status: Schema.String,
	output: Schema.Array(Schema.Unknown),
	usage: Schema.optional(ResponsesUsage),
	error: Schema.optional(Schema.Unknown),
});
const ChatFrame = Schema.Struct({
	choices: Schema.Array(
		Schema.Struct({
			index: Schema.Int,
			delta: Schema.Struct({
				content: Schema.optional(Schema.NullOr(Schema.String)),
				tool_calls: Schema.optional(
					Schema.Array(
						Schema.Struct({
							index: Schema.Int.pipe(Schema.nonNegative()),
							id: Schema.optional(Schema.String),
							function: Schema.optional(
								Schema.Struct({
									name: Schema.optional(Schema.String),
									arguments: Schema.optional(Schema.String),
								}),
							),
						}),
					),
				),
			}),
			finish_reason: Schema.NullOr(Schema.String),
		}),
	),
	usage: Schema.optional(Schema.NullOr(ChatUsage)),
	error: Schema.optional(Schema.Unknown),
});
const ErrorFrame = Schema.Struct({ error: Schema.Unknown });
const FunctionItem = Schema.Struct({ type: Schema.Literal("function_call") });
const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A =>
	Schema.decodeUnknownSync(schema)(value);
const text = (delta: string): RuntimeConversationEvent => ({
	_tag: "textDelta",
	kind: "generation",
	textDelta: delta,
});

/** HTTP only exposes client function requests, never built-in tool execution. */
export function normalizeOpenClawStream(
	response: RuntimeHttpResponse,
	protocol: OpenClawProtocol,
	sessionId: string,
): Stream.Stream<RuntimeConversationEvent, RuntimeError> {
	return Stream.suspend(() => {
		let terminal = false;
		let done = false;
		const emittedCalls = new Set<string>();
		const calls = new Map<
			number,
			{ id: string; name: string; arguments: string }
		>();
		const requested = (item: typeof Call.Type): RuntimeConversationEvent[] => {
			if (emittedCalls.has(item.call_id)) return [];
			emittedCalls.add(item.call_id);
			return [
				{
					_tag: "tool",
					toolCallId: item.call_id,
					tool: item.name,
					phase: "requested",
					arguments: item.arguments,
				},
			];
		};
		const events = parseSse(response).pipe(
			Stream.mapConcatEffect((frame) =>
				Effect.try({
					try: (): RuntimeConversationEvent[] => {
						if (done) throw new RuntimeProtocolInvalid();
						if (frame.data === "[DONE]") {
							if (!terminal) throw new RuntimeProtocolInvalid();
							done = true;
							return [];
						}
						const raw: unknown = JSON.parse(frame.data);
						if (Schema.is(ErrorFrame)(raw)) throw new RuntimeRequestFailed(raw);
						if (protocol === "responses") {
							if (terminal) throw new RuntimeProtocolInvalid();
							const envelope = decode(Envelope, raw);
							if (frame.event !== "message" && frame.event !== envelope.type)
								throw new RuntimeProtocolInvalid();
							switch (envelope.type) {
								case "response.output_text.delta":
									if (envelope.delta === undefined)
										throw new RuntimeProtocolInvalid();
									return envelope.delta ? [text(envelope.delta)] : [];
								case "response.output_item.done":
									return Schema.is(FunctionItem)(envelope.item)
										? requested(decode(Call, envelope.item))
										: [];
								case "response.failed":
								case "response.incomplete":
									throw new RuntimeRequestFailed(envelope.response);
								case "response.completed": {
									const resource = decode(Resource, envelope.response);
									if (
										resource.status !== "completed" ||
										resource.error !== undefined
									)
										throw new RuntimeRequestFailed(resource);
									terminal = true;
									const result = resource.output.flatMap((item) =>
										Schema.is(FunctionItem)(item)
											? requested(decode(Call, item))
											: [],
									);
									if (resource.usage)
										result.push({
											_tag: "usage",
											usage: {
												inputTokens: resource.usage.input_tokens,
												outputTokens: resource.usage.output_tokens,
												provenance: "reported",
											},
										});
									return result;
								}
								default:
									return [];
							}
						}
						const chunk = decode(ChatFrame, raw);
						if (chunk.error !== undefined)
							throw new RuntimeRequestFailed(chunk.error);
						const result: RuntimeConversationEvent[] = [];
						for (const choice of chunk.choices) {
							if (terminal || choice.index !== 0)
								throw new RuntimeProtocolInvalid();
							if (choice.delta.content) result.push(text(choice.delta.content));
							for (const call of choice.delta.tool_calls ?? []) {
								if (call.index >= 128) throw new RuntimeProtocolInvalid();
								const accumulated = calls.get(call.index) ?? {
									id: "",
									name: "",
									arguments: "",
								};
								if (call.id !== undefined) {
									if (accumulated.id && accumulated.id !== call.id)
										throw new RuntimeProtocolInvalid();
									accumulated.id = call.id;
								}
								if (call.function?.name !== undefined)
									accumulated.name += call.function.name;
								accumulated.arguments += call.function?.arguments ?? "";
								if (
									accumulated.arguments.length > 262144 ||
									accumulated.name.length > 256
								)
									throw new RuntimeProtocolInvalid();
								calls.set(call.index, accumulated);
							}
							if (choice.finish_reason !== null) {
								if (
									choice.finish_reason !== "stop" &&
									choice.finish_reason !== "tool_calls"
								)
									throw new RuntimeRequestFailed();
								if (choice.finish_reason === "tool_calls") {
									if (!calls.size) throw new RuntimeProtocolInvalid();
									for (const call of calls.values())
										result.push(
											...requested(
												decode(Call, {
													type: "function_call",
													call_id: call.id,
													name: call.name,
													arguments: call.arguments,
												}),
											),
										);
								} else if (calls.size) throw new RuntimeProtocolInvalid();
								terminal = true;
							}
						}
						if (chunk.usage)
							result.push({
								_tag: "usage",
								usage: {
									inputTokens: chunk.usage.prompt_tokens,
									outputTokens: chunk.usage.completion_tokens,
									provenance: "reported",
								},
							});
						return result;
					},
					catch: (cause) =>
						cause instanceof RuntimeProtocolInvalid ||
						cause instanceof RuntimeRequestFailed
							? cause
							: new RuntimeProtocolInvalid(cause),
				}),
			),
		);
		return events.pipe(
			Stream.concat(
				Stream.fromEffect(
					Effect.suspend(() =>
						done
							? Effect.succeed<RuntimeConversationEvent>({
									_tag: "completed",
									sessionId,
								})
							: Effect.fail(new RuntimeProtocolInvalid()),
					),
				),
			),
		);
	});
}

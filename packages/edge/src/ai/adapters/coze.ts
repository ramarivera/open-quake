import { Effect, Redacted, Schema, Stream } from "effect";
import type { NormalizedEvent } from "../ai-contracts.js";
import {
	AiCapabilityUnsupported,
	AiConfigInvalid,
	AiProtocolInvalid,
	AiUnavailable,
	isAiError,
	translateProviderFailure,
} from "../ai-errors.js";
import { validEndpoint } from "../ai-invariants.js";
import { abortableStream, type CompatibleAdapter } from "./adapter.js";

const Event = Schema.Struct({
	code: Schema.optional(Schema.Number),
	type: Schema.optional(Schema.String),
	content: Schema.optional(Schema.String),
	status: Schema.optional(Schema.String),
	usage: Schema.optional(
		Schema.Struct({
			input_count: Schema.Int.pipe(Schema.nonNegative()),
			output_count: Schema.Int.pipe(Schema.nonNegative()),
		}),
	),
});
/** Per-request parser. Handles UTF-8, CRLF, multiline data and split records. */
async function* records(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
	const reader = body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let pending = "";
	try {
		while (!signal.aborted) {
			const { value, done } = await reader.read();
			pending += decoder.decode(value, { stream: !done });
			pending = pending.replace(/\r\n/g, "\n");
			if (pending.length > 1048576) throw new AiProtocolInvalid();
			let end = pending.indexOf("\n\n");
			while (end >= 0) {
				const record = pending.slice(0, end);
				pending = pending.slice(end + 2);
				const lines = record.split("\n");
				yield {
					event:
						lines
							.find((l) => l.startsWith("event:"))
							?.slice(6)
							.trim() ?? "",
					data: lines
						.filter((l) => l.startsWith("data:"))
						.map((l) => l.slice(5).trimStart())
						.join("\n"),
				};
				end = pending.indexOf("\n\n");
			}
			if (done) {
				if (pending.trim()) throw new AiProtocolInvalid();
				return;
			}
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
export function makeCozeAdapter(
	fetcher: typeof fetch = globalThis.fetch,
): CompatibleAdapter {
	return {
		open: Effect.fn("CozeAdapter.open")(function* (input) {
			const botId = input.profile.settings?.botId;
			if (
				!botId?.trim() ||
				!validEndpoint(input.profile.baseUrl, input.profile.endpointPolicy)
			)
				return yield* new AiConfigInvalid();
			if (
				input.request.tools?.length ||
				input.request.messages.some(
					(m) => m.role === "tool" || m.toolCalls?.length,
				)
			)
				return yield* new AiCapabilityUnsupported("tools");
			if (
				input.request.messages.some((m) =>
					m.content.some((p) => p._tag !== "text"),
				)
			)
				return yield* new AiCapabilityUnsupported("images");
			const controller = new AbortController();
			const signal = AbortSignal.any([input.signal, controller.signal]);
			const events = abortableStream(
				(async function* (): AsyncGenerator<NormalizedEvent> {
					try {
						const response = await fetcher(
							`${input.profile.baseUrl.replace(/\/$/, "")}/v3/chat`,
							{
								method: "POST",
								redirect: "error",
								signal,
								headers: {
									authorization: `Bearer ${Redacted.value(input.credential)}`,
									"content-type": "application/json",
								},
								body: JSON.stringify({
									bot_id: botId,
									user_id: crypto.randomUUID(),
									stream: true,
									auto_save_history: false,
									additional_messages: input.request.messages.map((m) => ({
										role: m.role === "system" ? "user" : m.role,
										type: m.role === "assistant" ? "answer" : "question",
										content_type: "text",
										content: m.content
											.map((p) => (p._tag === "text" ? p.text : ""))
											.join(""),
									})),
								}),
							},
						);
						if (!response.ok)
							throw translateProviderFailure(response.status, undefined);
						if (!response.body) throw new AiProtocolInvalid();
						let completed = false;
						for await (const record of records(response.body, signal)) {
							if (signal.aborted) return;
							if (!record.data || record.data === "[DONE]") continue;
							const data = Schema.decodeUnknownSync(Schema.parseJson(Event))(
								record.data,
							);
							if (
								data.code ||
								record.event === "error" ||
								record.event === "conversation.chat.failed" ||
								record.event === "conversation.chat.requires_action"
							)
								throw new AiProtocolInvalid();
							if (
								record.event === "conversation.message.delta" &&
								data.type === "answer" &&
								data.content
							)
								yield {
									_tag: "textDelta",
									textDelta: data.content,
									kind: "generation",
								};
							if (
								record.event === "conversation.message.completed" &&
								data.type === "follow_up" &&
								data.content
							)
								yield {
									_tag: "suggestion",
									suggestionId: crypto.randomUUID(),
									text: data.content.slice(0, 4096),
								};
							if (record.event === "conversation.chat.completed") {
								if (data.status !== "completed") throw new AiProtocolInvalid();
								if (data.usage)
									yield {
										_tag: "usage",
										usage: {
											inputTokens: data.usage.input_count,
											outputTokens: data.usage.output_count,
											provenance: "reported",
										},
									};
								completed = true;
								yield { _tag: "completed" };
								return;
							}
						}
						if (!completed && !signal.aborted) throw new AiProtocolInvalid();
					} finally {
						controller.abort();
					}
				})(),
				(cause) => (isAiError(cause) ? cause : new AiProtocolInvalid(cause)),
				() => controller.abort(),
			);
			return events.pipe(
				Stream.interruptWhen(
					Effect.sleep("60 seconds").pipe(
						Effect.zipRight(Effect.fail(new AiUnavailable())),
					),
				),
				Stream.ensuring(Effect.sync(() => controller.abort())),
			);
		}),
	};
}

import { Effect, Redacted, Schema, Stream } from "effect";
import {
	AiCapabilityUnsupported,
	AiConfigInvalid,
	AiProtocolInvalid,
	AiUnavailable,
	isAiError,
	translateProviderFailure,
} from "../ai-errors.js";
import type { CompatibleAdapter } from "./adapter.js";
import { boundedText } from "./files.js";

const Task = Schema.Struct({
	output: Schema.Struct({
		task_id: Schema.optional(
			Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,256}$/)),
		),
		task_status: Schema.optional(
			Schema.Literal(
				"PENDING",
				"RUNNING",
				"SUCCEEDED",
				"FAILED",
				"CANCELED",
				"UNKNOWN",
			),
		),
		video_url: Schema.optional(Schema.String),
		results: Schema.optional(
			Schema.Array(Schema.Struct({ url: Schema.String })).pipe(
				Schema.maxItems(4),
			),
		),
	}),
});
/** Explicit DashScope profile only. No endpoint, model or credential fallback. */
export function makeDashscopeMediaAdapter(
	fetcher: typeof fetch = globalThis.fetch,
): CompatibleAdapter {
	return {
		open: Effect.fn("DashscopeMedia.open")(function* (input) {
			const kind = input.profile.settings?.mediaKind;
			if (input.profile.provider !== "qwen" || !kind)
				return yield* new AiConfigInvalid();
			if (
				input.request.tools?.length ||
				input.request.messages.some((m) =>
					m.content.some((p) => p._tag !== "text"),
				)
			)
				return yield* new AiCapabilityUnsupported("tools");
			if (
				input.profile.capabilities[
					kind === "image" ? "imageGeneration" : "videoGeneration"
				] !== "supported"
			)
				return yield* new AiCapabilityUnsupported(
					kind === "image" ? "imageGeneration" : "videoGeneration",
				);
			const prompt = input.request.messages
				.filter((m) => m.role === "user")
				.at(-1)
				?.content.flatMap((p) => (p._tag === "text" ? [p.text] : []))
				.join("");
			if (!prompt?.trim() || prompt.length > 16384)
				return yield* new AiConfigInvalid();
			const controller = new AbortController();
			const signal = AbortSignal.any([input.signal, controller.signal]);
			const base = input.profile.baseUrl.replace(/\/$/, "");
			const headers = {
				authorization: `Bearer ${Redacted.value(input.credential)}`,
				"content-type": "application/json",
				"X-DashScope-Async": "enable",
			};
			const call = (path: string, body?: unknown) =>
				Effect.tryPromise({
					try: async () => {
						const response = await fetcher(`${base}${path}`, {
							method: body === undefined ? "GET" : "POST",
							headers,
							signal,
							redirect: "error",
							...(body === undefined ? {} : { body: JSON.stringify(body) }),
						});
						if (!response.ok)
							throw translateProviderFailure(response.status, undefined);
						return Schema.decodeUnknownSync(Schema.parseJson(Task))(
							await boundedText(response),
						);
					},
					catch: (cause) =>
						isAiError(cause) ? cause : new AiProtocolInvalid(cause),
				});
			const operation = Effect.gen(function* () {
				const created = yield* call(
					kind === "image"
						? "/services/aigc/text2image/image-synthesis"
						: "/services/aigc/video-generation/video-synthesis",
					{
						model: input.profile.modelId,
						input: { prompt },
						parameters:
							kind === "image"
								? { size: "1024*1024", n: 1 }
								: {
										size: "832*480",
										duration: 5,
										prompt_extend: true,
										watermark: false,
									},
					},
				);
				const id = created.output.task_id;
				if (!id) return yield* new AiProtocolInvalid();
				for (let attempt = 0; attempt < 60; attempt++) {
					const state: typeof Task.Type.output = (yield* call(
						`/tasks/${encodeURIComponent(id)}`,
					)).output;
					if (state.task_id && state.task_id !== id)
						return yield* new AiProtocolInvalid();
					if (state.task_status === "SUCCEEDED") {
						const raw =
							kind === "image" ? state.results?.[0]?.url : state.video_url;
						const url = yield* Effect.try({
							try: () => new URL(raw ?? ""),
							catch: (cause) => new AiProtocolInvalid(cause),
						});
						if (
							url.protocol !== "https:" ||
							url.username ||
							url.password ||
							url.href.length > 4096
						)
							return yield* new AiProtocolInvalid();
						const safe = url.href.replaceAll("(", "%28").replaceAll(")", "%29");
						return Stream.make(
							{
								_tag: "textDelta" as const,
								kind: "generation" as const,
								textDelta: `[Generated ${kind}](${safe})`,
							},
							{ _tag: "completed" as const },
						);
					}
					if (
						state.task_status !== "PENDING" &&
						state.task_status !== "RUNNING"
					)
						return yield* new AiProtocolInvalid();
					yield* Effect.sleep("5 seconds");
				}
				return yield* new AiUnavailable();
			});
			return Stream.unwrap(operation).pipe(
				Stream.ensuring(Effect.sync(() => controller.abort())),
			);
		}),
	};
}

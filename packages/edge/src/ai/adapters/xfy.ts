import { Effect, Redacted, Schema, Stream } from "effect";
import type { NormalizedEvent } from "../ai-contracts.js";
import {
	AiAuthRequired,
	AiCapabilityUnsupported,
	AiConfigInvalid,
	AiProtocolInvalid,
	AiUnavailable,
} from "../ai-errors.js";
import { abortableStream, type CompatibleAdapter } from "./adapter.js";
export const SparkCredentials = Schema.Struct({
	appId: Schema.NonEmptyTrimmedString,
	apiKey: Schema.NonEmptyTrimmedString,
	apiSecret: Schema.NonEmptyTrimmedString,
});
export interface SparkSocket {
	readonly send: (frame: string) => Promise<void>;
	readonly frames: AsyncIterable<string>;
	readonly close: () => void;
}
export type SparkConnect = (
	url: string,
	signal: AbortSignal,
) => Promise<SparkSocket>;
const domains: Readonly<
	Record<string, { readonly path: string; readonly domain: string }>
> = {
	"spark3.5": { path: "/v3.5/chat", domain: "generalv3.5" },
	"spark3.5-max": { path: "/v3.5/chat", domain: "generalv3.5" },
	"spark-pro": { path: "/v3.1/chat", domain: "generalv3" },
	"spark4-ultra": { path: "/v4.0/chat", domain: "4.0Ultra" },
};
const Frame = Schema.Struct({
	header: Schema.Struct({
		code: Schema.Int,
		status: Schema.Int.pipe(Schema.between(0, 2)),
		sid: Schema.optional(Schema.String),
	}),
	payload: Schema.optional(
		Schema.Struct({
			choices: Schema.Struct({
				status: Schema.Int.pipe(Schema.between(0, 2)),
				text: Schema.Array(Schema.Struct({ content: Schema.String })),
			}),
			usage: Schema.optional(
				Schema.Struct({
					text: Schema.Struct({
						prompt_tokens: Schema.Int.pipe(Schema.nonNegative()),
						completion_tokens: Schema.Int.pipe(Schema.nonNegative()),
					}),
				}),
			),
		}),
	),
});
/** The vendor wire requires a short-lived HMAC URL. Never persist or log it. */
export async function sparkSignedUrl(
	path: string,
	credentials: typeof SparkCredentials.Type,
	date: string,
): Promise<string> {
	const host = "spark-api.xf-yun.com";
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(credentials.apiSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(`host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`),
	);
	const auth = `api_key="${credentials.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${btoa(String.fromCharCode(...new Uint8Array(signature)))}"`;
	const url = new URL(`wss://${host}${path}`);
	url.searchParams.set("authorization", btoa(auth));
	url.searchParams.set("date", date);
	url.searchParams.set("host", host);
	return url.href;
}
export function makeSparkAdapter(
	connect: SparkConnect,
	now: () => Date = () => new Date(),
): CompatibleAdapter {
	return {
		open: Effect.fn("SparkAdapter.open")(function* (input) {
			if (
				input.profile.baseUrl.replace(/\/$/, "") !==
				"https://spark-api.xf-yun.com"
			)
				return yield* new AiConfigInvalid();
			const domain = domains[input.profile.modelId];
			if (!domain) return yield* new AiConfigInvalid();
			if (
				input.request.tools?.length ||
				input.request.requestedCapabilities.includes("tools") ||
				input.request.messages.some(
					(m) => m.toolCalls?.length || m.role === "tool",
				)
			)
				return yield* new AiCapabilityUnsupported("tools");
			if (
				input.request.messages.some((m) =>
					m.content.some((p) => p._tag !== "text"),
				)
			)
				return yield* new AiCapabilityUnsupported("images");
			const credentials = yield* Schema.decodeUnknown(
				Schema.parseJson(SparkCredentials),
			)(Redacted.value(input.credential)).pipe(
				Effect.mapError((cause) => new AiAuthRequired(cause)),
			);
			const controller = new AbortController();
			const signal = AbortSignal.any([input.signal, controller.signal]);
			return Stream.unwrapScoped(
				Effect.gen(function* () {
					yield* Effect.addFinalizer(() =>
						Effect.sync(() => controller.abort()),
					);
					const url = yield* Effect.tryPromise({
						try: () =>
							sparkSignedUrl(domain.path, credentials, now().toUTCString()),
						catch: (cause) => new AiAuthRequired(cause),
					});
					const socket = yield* Effect.acquireRelease(
						Effect.interruptible(
							Effect.tryPromise({
								try: async (acquireSignal) => {
									const combined = AbortSignal.any([signal, acquireSignal]);
									const socket = await connect(url, combined);
									if (combined.aborted) {
										socket.close();
										throw new AiUnavailable();
									}
									return socket;
								},
								catch: (cause) => new AiUnavailable(cause),
							}),
						),
						(socket) => Effect.sync(() => socket.close()),
					);
					yield* Effect.tryPromise({
						try: () =>
							socket.send(
								JSON.stringify({
									header: { app_id: credentials.appId, uid: "open-quake" },
									parameter: {
										chat: {
											domain: domain.domain,
											temperature: input.request.sampling.temperature ?? 0.5,
											max_tokens:
												input.request.sampling.maxOutputTokens ?? 4096,
										},
									},
									payload: {
										message: {
											text: input.request.messages.map((m) => ({
												role: m.role,
												content: m.content
													.map((p) => (p._tag === "text" ? p.text : ""))
													.join(""),
											})),
										},
									},
								}),
							),
						catch: (cause) => new AiUnavailable(cause),
					});
					return abortableStream(
						(async function* (): AsyncGenerator<NormalizedEvent> {
							let started = false;
							for await (const raw of socket.frames) {
								if (signal.aborted) return;
								if (raw.length > 1048576) throw new AiProtocolInvalid();
								const frame = Schema.decodeUnknownSync(Schema.parseJson(Frame))(
									raw,
								);
								if (frame.header.code !== 0 || !frame.payload)
									throw new AiProtocolInvalid();
								const choices = frame.payload.choices;
								if (
									(started && choices.status === 0) ||
									(!started && choices.status === 1) ||
									frame.header.status !== choices.status
								)
									throw new AiProtocolInvalid();
								started = true;
								for (const text of choices.text)
									if (text.content)
										yield {
											_tag: "textDelta",
											textDelta: text.content,
											kind: "generation",
										};
								if (choices.status === 2) {
									if (frame.payload.usage)
										yield {
											_tag: "usage",
											usage: {
												inputTokens: frame.payload.usage.text.prompt_tokens,
												outputTokens:
													frame.payload.usage.text.completion_tokens,
												provenance: "reported",
											},
										};
									yield { _tag: "completed" };
									return;
								}
							}
							if (!signal.aborted) throw new AiProtocolInvalid();
						})(),
						(cause) =>
							cause instanceof AiProtocolInvalid
								? cause
								: new AiProtocolInvalid(cause),
						() => {
							controller.abort();
							socket.close();
						},
					);
				}),
			).pipe(
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

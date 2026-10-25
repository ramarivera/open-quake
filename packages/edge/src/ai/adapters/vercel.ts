import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	APICallError,
	InvalidResponseDataError,
	JSONParseError,
	type ModelMessage,
	streamText,
	TypeValidationError,
} from "ai";
import { Effect, Layer, Redacted, Stream } from "effect";
import type { NormalizedEvent } from "../ai-contracts.js";
import {
	AiAuthRequired,
	AiAuthRevoked,
	AiCapabilityUnsupported,
	AiConfigInvalid,
	AiCredentialStoreFailed,
	type AiError,
	AiProtocolInvalid,
	AiRateLimited,
	AiUnavailable,
	translateProviderFailure,
} from "../ai-errors.js";
import { validEndpoint } from "../ai-invariants.js";
import { AiCompatibleAdapter, type CompatibleAdapter } from "./adapter.js";

function sdkFailure(cause: unknown): AiError {
	if (
		cause instanceof AiProtocolInvalid ||
		cause instanceof AiCapabilityUnsupported ||
		cause instanceof AiAuthRequired ||
		cause instanceof AiAuthRevoked ||
		cause instanceof AiRateLimited ||
		cause instanceof AiUnavailable ||
		cause instanceof AiConfigInvalid ||
		cause instanceof AiCredentialStoreFailed
	)
		return cause;
	if (
		InvalidResponseDataError.isInstance(cause) ||
		JSONParseError.isInstance(cause) ||
		TypeValidationError.isInstance(cause)
	)
		return new AiProtocolInvalid(cause);
	return translateProviderFailure(
		APICallError.isInstance(cause) ? cause.statusCode : undefined,
		cause,
	);
}

/** Production SDK boundary. The injected fetch is also used by offline HTTP fixtures. */
export function makeVercelCompatibleAdapter(
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): CompatibleAdapter {
	return {
		open: Effect.fn("VercelCompatibleAdapter.open")(
			function* (
				input,
			): Effect.fn.Return<Stream.Stream<NormalizedEvent, AiError>, AiError> {
				if (!validEndpoint(input.profile.baseUrl, input.profile.endpointPolicy))
					return yield* new AiConfigInvalid();
				if (
					input.request.messages.some((message) =>
						message.content.some((part) => part._tag !== "text"),
					)
				)
					return yield* new AiCapabilityUnsupported("images");
				if (
					input.request.requestedCapabilities.some(
						(capability) => capability !== "text",
					)
				)
					return yield* new AiCapabilityUnsupported(
						input.request.requestedCapabilities.find(
							(capability) => capability !== "text",
						) ?? "tools",
					);
				const messages: ModelMessage[] = input.request.messages.map(
					(message) => ({
						role: message.role,
						content: message.content
							.map((part) => (part._tag === "text" ? part.text : ""))
							.join(""),
					}),
				);
				const controller = new AbortController();
				const signal = AbortSignal.any([input.signal, controller.signal]);
				// Provider-name options become request-body fields in compatible 3.0.78.
				// reasoning_effort is a known SDK option and must use its camelCase spelling.
				const { reasoning_effort, ...bodyOptions } = input.providerOptions;
				const provider = createOpenAICompatible({
					name: "quake",
					baseURL: input.profile.baseUrl,
					apiKey: Redacted.value(input.credential),
					includeUsage: true,
					fetch: (url, init) =>
						fetcher(url, { ...init, redirect: "error", signal }),
				});
				const events = Stream.fromAsyncIterable(
					(async function* (): AsyncGenerator<NormalizedEvent> {
						let completed = false;
						let outputText = "";
						const result = streamText({
							model: provider.chatModel(input.profile.modelId),
							messages,
							allowSystemInMessages: true,
							abortSignal: signal,
							maxRetries: 0,
							...(input.request.sampling.temperature === undefined
								? {}
								: { temperature: input.request.sampling.temperature }),
							...(input.request.sampling.topP === undefined
								? {}
								: { topP: input.request.sampling.topP }),
							...(input.request.sampling.maxOutputTokens === undefined ||
							input.providerOptions.max_completion_tokens !== undefined
								? {}
								: { maxOutputTokens: input.request.sampling.maxOutputTokens }),
							providerOptions: {
								quake: {
									...bodyOptions,
									...(reasoning_effort === undefined
										? {}
										: { reasoningEffort: reasoning_effort }),
								},
							},
							// No tools, no downloads, no SDK logging or payload telemetry.
							onError: () => {},
							experimental_telemetry: { isEnabled: false },
						});
						try {
							for await (const part of result.fullStream) {
								if (signal.aborted) return;
								switch (part.type) {
									case "text-delta":
										outputText += part.text;
										yield {
											_tag: "textDelta",
											textDelta: part.text,
											kind: "generation",
										};
										break;
									case "error":
										throw sdkFailure(part.error);
									case "abort":
										return;
									case "tool-call":
									case "tool-input-start":
									case "tool-result":
										throw new AiCapabilityUnsupported("tools");
									case "finish": {
										if (part.finishReason !== "stop")
											throw new AiProtocolInvalid();
										const inputTokens = part.totalUsage.inputTokens;
										const outputTokens = part.totalUsage.outputTokens;
										if (
											inputTokens !== undefined &&
											outputTokens !== undefined
										) {
											if (
												!Number.isSafeInteger(inputTokens) ||
												!Number.isSafeInteger(outputTokens) ||
												inputTokens < 0 ||
												outputTokens < 0
											)
												throw new AiProtocolInvalid();
											yield {
												_tag: "usage",
												usage: {
													inputTokens,
													outputTokens,
													provenance: "reported",
												},
											};
										} else {
											yield {
												_tag: "usage",
												usage: {
													inputTokens: messages.reduce(
														(sum, message) =>
															sum +
															new TextEncoder().encode(String(message.content))
																.length +
															8,
														0,
													),
													outputTokens: new TextEncoder().encode(outputText)
														.length,
													provenance: "estimated",
												},
											};
										}
										completed = true;
										yield { _tag: "completed" };
										return;
									}
								}
							}
							if (!completed && !signal.aborted) throw new AiProtocolInvalid();
						} finally {
							controller.abort();
						}
					})(),
					sdkFailure,
				).pipe(Stream.ensuring(Effect.sync(() => controller.abort())));
				return events;
			},
		),
	};
}

export const VercelCompatibleAdapterLive = Layer.succeed(
	AiCompatibleAdapter,
	makeVercelCompatibleAdapter(),
);

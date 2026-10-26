import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	APICallError,
	dynamicTool,
	InvalidResponseDataError,
	JSONParseError,
	jsonSchema,
	type ModelMessage,
	stepCountIs,
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
import {
	AiCompatibleAdapter,
	abortableStream,
	type CompatibleAdapter,
} from "./adapter.js";
import { collectSearchSources, type SearchSource } from "./search-sources.js";
import type { AiToolBridge } from "./tool-bridge.js";

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
	bridge?: typeof AiToolBridge.Service,
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
						(capability) => capability !== "text" && capability !== "tools",
					)
				)
					return yield* new AiCapabilityUnsupported(
						input.request.requestedCapabilities.find(
							(capability) => capability !== "text" && capability !== "tools",
						) ?? "tools",
					);
				if (
					(input.request.tools?.length ||
						input.request.requestedCapabilities.includes("tools")) &&
					!bridge
				)
					return yield* new AiCapabilityUnsupported("tools");
				const messages: ModelMessage[] = input.request.messages.map(
					(message): ModelMessage => {
						const text = message.content
							.map((part) => (part._tag === "text" ? part.text : ""))
							.join("");
						if (message.role === "tool")
							return {
								role: "tool",
								content: [
									{
										type: "tool-result",
										toolCallId: message.toolCallId ?? "",
										toolName: message.toolName ?? "",
										output: { type: "text", value: text },
									},
								],
							};
						if (message.role !== "assistant")
							return { role: message.role, content: text };
						return {
							role: "assistant",
							content: [
								{ type: "text", text },
								...(message.reasoningContent === undefined
									? []
									: [
											{
												type: "reasoning" as const,
												text: message.reasoningContent,
											},
										]),
								...(message.toolCalls ?? []).map((call) => ({
									type: "tool-call" as const,
									toolCallId: call.id,
									toolName: call.name,
									input: JSON.parse(call.arguments) as unknown,
								})),
							],
						};
					},
				);
				const controller = new AbortController();
				const signal = AbortSignal.any([input.signal, controller.signal]);
				// Provider-name options become request-body fields in compatible 3.0.78.
				// reasoning_effort is a known SDK option and must use its camelCase spelling.
				const { reasoning_effort, ...bodyOptions } = input.providerOptions;
				const sources: SearchSource[] = [];
				const wantSources =
					input.request.controls?.webSearch === true &&
					(input.profile.provider === "zhipu" ||
						input.request.controls.searchOptions?.enable_source === true);
				const send: typeof fetch = async (url, init) => {
					const response = await fetcher(url, init);
					return wantSources && response.ok
						? collectSearchSources(response, sources)
						: response;
				};
				const provider = createOpenAICompatible({
					name: "quake",
					baseURL: input.profile.baseUrl,
					apiKey: Redacted.value(input.credential),
					includeUsage: true,
					fetch: (url, init) => {
						// SDK drops empty reasoning parts. These providers require the placeholder.
						if (
							(input.profile.provider === "kimi" ||
								input.profile.provider === "deepseek" ||
								input.providerOptions.tools) &&
							typeof init?.body === "string"
						) {
							const body: unknown = JSON.parse(init.body);
							if (
								body &&
								typeof body === "object" &&
								"messages" in body &&
								Array.isArray(body.messages)
							) {
								if (input.providerOptions.tools)
									Object.assign(body, { tools: input.providerOptions.tools });
								for (const message of body.messages)
									if (
										message &&
										typeof message === "object" &&
										message.role === "assistant" &&
										Array.isArray(message.tool_calls) &&
										message.tool_calls.length &&
										message.reasoning_content == null &&
										(input.profile.provider === "kimi" ||
											input.profile.provider === "deepseek")
									)
										message.reasoning_content = "";
								return send(url, {
									...init,
									body: JSON.stringify(body),
									redirect: "error",
									signal,
								});
							}
						}
						return send(url, { ...init, redirect: "error", signal });
					},
				});
				const events = abortableStream(
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
							...(input.request.tools?.length && bridge
								? {
										tools: Object.fromEntries(
											input.request.tools.map((definition) => [
												definition.name,
												dynamicTool({
													description: definition.description,
													inputSchema: jsonSchema({
														type: "object",
														properties: definition.properties,
														required: [...definition.required],
														additionalProperties: false,
													}),
													execute: (args) =>
														Effect.runPromise(
															Effect.suspend(() => {
																if (
																	!args ||
																	typeof args !== "object" ||
																	Array.isArray(args)
																)
																	return Effect.fail(new AiConfigInvalid());
																const entries = Object.entries(args);
																if (
																	definition.required.some(
																		(key) =>
																			!entries.some(([name]) => name === key),
																	) ||
																	entries.some(
																		([key, value]) =>
																			!definition.properties[key] ||
																			typeof value !==
																				definition.properties[key]?.type ||
																			(typeof value === "number" &&
																				!Number.isFinite(value)),
																	)
																)
																	return Effect.fail(new AiConfigInvalid());
																return bridge
																	.execute(definition.name, args, signal)
																	.pipe(
																		Effect.flatMap((output) =>
																			output.length > 1048576
																				? Effect.fail(new AiProtocolInvalid())
																				: Effect.succeed(output),
																		),
																	);
															}),
															{ signal },
														),
												}),
											]),
										),
										stopWhen: stepCountIs(4),
									}
								: {}),
							// No downloads, SDK logging or payload telemetry.
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
										if (!input.request.tools?.length || !bridge)
											throw new AiCapabilityUnsupported("tools");
										break;
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
										if (outputText.trim() && sources.length)
											yield {
												_tag: "textDelta",
												textDelta:
													"\n\nSources from provider search\n" +
													sources
														.map(
															(source) => `- [${source.title}](${source.url})`,
														)
														.join("\n"),
												kind: "generation",
											};
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
					() => controller.abort(),
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

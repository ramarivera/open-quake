import { createHash } from "node:crypto";
import { isIPv4 } from "node:net";
import { Cause, Effect, Either, Exit, Layer, Schema } from "effect";
import { net } from "electron";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { resolveModelRows } from "../../../../../packages/edge/src/agents/agents-invariants";
import { AiCompatibleAdapter } from "../../../../../packages/edge/src/ai/adapters/adapter";
import {
	AiFileAdapter,
	makeFileAdapter,
} from "../../../../../packages/edge/src/ai/adapters/files";
import { makeProviderAdapter } from "../../../../../packages/edge/src/ai/adapters/provider-adapter";
import type { SparkConnect } from "../../../../../packages/edge/src/ai/adapters/xfy";
import { AiConnectivity } from "../../../../../packages/edge/src/ai/ai-connectivity";
import {
	CredentialRef,
	type ProfileId,
	type ProviderProfile,
} from "../../../../../packages/edge/src/ai/ai-contracts";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	AiAuthRequired,
	AiConfigInvalid,
	type AiError,
	AiUnavailable,
} from "../../../../../packages/edge/src/ai/ai-errors";
import { PublicFileRequest } from "../../../../../packages/edge/src/ai/ai-file-contracts";
import { validateProfile } from "../../../../../packages/edge/src/ai/ai-invariants";
import { AiRepository } from "../../../../../packages/edge/src/ai/ai-repository";
import { AiProviderService } from "../../../../../packages/edge/src/ai/ai-service";
import {
	canonicalProvider,
	localProviderListing,
	modelOptions,
	volcBaseUrl,
} from "../../../../../packages/edge/src/ai/provider-catalog";
import type {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import type { ChatError } from "../../../../../packages/edge/src/chat/chat-errors";
import { ChatInferenceLive } from "../../../../../packages/edge/src/chat/chat-ports";
import {
	ChatRepository,
	fileChatStorageLayer,
} from "../../../../../packages/edge/src/chat/chat-repository";
import {
	type ChatInput,
	ChatRpcFailure,
	type PublicChatHistory,
} from "../../../../../packages/edge/src/chat/chat-rpc";
import { ChatService } from "../../../../../packages/edge/src/chat/chat-service";
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import type { PinnedDirectModel } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import { connectSpark } from "../credentials/spark-socket";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { shortcutDraft } from "./shortcut-draft";

const OWNER = "desktop-user";
/** Endpoint changes create a different profile. A turn never reads mutable renderer settings. */
export function profileFromModel(row: ModelRow): ProviderProfile {
	return {
		...profileMetadataFromModel(row),
		credentialRef: Schema.decodeUnknownSync(CredentialRef)(row.credentialRef),
	};
}
/** Listing metadata is independent of whether the host has a usable key. */
function profileMetadataFromModel(row: ModelRow): ProviderProfile {
	const hex = createHash("sha256")
		.update(
			JSON.stringify([
				row.id,
				row.provider,
				row.baseUrl,
				row.model,
				row.credentialRef,
				row.settings,
				row.controls,
			]),
		)
		.digest("hex");
	const id =
		`${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ProfileId;
	const selectedProvider = canonicalProvider(row.provider);
	const baseUrl =
		selectedProvider === "volc" && !row.baseUrl
			? volcBaseUrl(row.settings?.entryMethod ?? "inference")
			: row.baseUrl;
	const url = new URL(baseUrl);
	const loopback =
		url.hostname === "localhost" ||
		url.hostname === "[::1]" ||
		(isIPv4(url.hostname) && url.hostname.startsWith("127."));
	return {
		version: 1,
		id,
		adapter:
			row.settings?.mediaKind && selectedProvider === "qwen"
				? "dashscope-media"
				: selectedProvider === "coze"
					? "coze"
					: selectedProvider === "xfy"
						? "xfy"
						: "openai-compatible",
		baseUrl,
		...(row.settings ? { settings: row.settings } : {}),
		...(row.controls ? { controls: row.controls } : {}),
		...(row.settings?.mediaKind
			? { models: { [row.settings.mediaKind]: row.model } }
			: {}),
		endpointPolicy: loopback ? "loopback" : "remote",
		modelId:
			selectedProvider === "volc"
				? (row.settings?.botId ?? row.model)
				: row.model,
		provider:
			selectedProvider === "openai" ||
			selectedProvider === "qwen" ||
			selectedProvider === "kimi" ||
			selectedProvider === "deepseek" ||
			selectedProvider === "zhipu" ||
			selectedProvider === "groq" ||
			selectedProvider === "volc" ||
			selectedProvider === "coze" ||
			selectedProvider === "xfy"
				? selectedProvider
				: "generic",
		auth: "apiKey",
		authGeneration: 0,
		capabilities: {
			text: "supported",
			tools: "unsupported",
			images: "unsupported",
			imageGeneration:
				row.settings?.mediaKind === "image" && selectedProvider === "qwen"
					? "supported"
					: "unsupported",
			videoGeneration:
				row.settings?.mediaKind === "video" && selectedProvider === "qwen"
					? "supported"
					: "unsupported",
			stt: "unsupported",
			tts: "unsupported",
		},
		sampling: {
			maxOutputTokens: Math.min(row.maxTokens, 65536),
			...(row.temperature === undefined
				? {}
				: { temperature: row.temperature }),
			...(row.topP === undefined ? {} : { topP: row.topP }),
		},
		samplingLimits: {
			maxOutputTokens: Math.min(row.maxTokens, 65536),
			temperature: { min: 0, max: 2 },
			topP: { min: 0, max: 1 },
		},
	};
}
export interface DirectChatOptions {
	readonly directory: string;
	readonly credentials: typeof AiCredentials.Service;
	readonly models: (
		scope: string,
	) => Effect.Effect<readonly ModelRow[], AiError>;
	readonly diagnostics?: DesktopDiagnostics;
	readonly fetch?: typeof globalThis.fetch;
	readonly online?: () => boolean;
	readonly sparkConnect?: SparkConnect;
}
export const rpcFailure = (error: ChatError | AiError): ChatRpcFailure =>
	new ChatRpcFailure({ code: error.code, message: error.message });
export function prepareDirectChat(options: DirectChatOptions) {
	const profiles = AiRepository.Default;
	const inference = ChatInferenceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(
					AiCompatibleAdapter,
					makeProviderAdapter(
						options.fetch,
						options.sparkConnect ?? connectSpark,
					),
				),
				Layer.succeed(AiCredentials, options.credentials),
				Layer.succeed(AiConnectivity, {
					online: () => Effect.sync(() => options.online?.() ?? net.isOnline()),
				}),
			),
		),
	);
	const facade = AiProviderService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(profiles),
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiCredentials, options.credentials),
				Layer.succeed(AiFileAdapter, makeFileAdapter(options.fetch)),
				Layer.succeed(AiConnectivity, {
					online: () => Effect.sync(() => options.online?.() ?? net.isOnline()),
				}),
			),
		),
	);
	const dependencies = Layer.mergeAll(
		facade,
		profiles,
		inference,
		ChatRepository.Default.pipe(
			Layer.provide(fileChatStorageLayer(options.directory)),
		),
	);

	const prepared = prepareDesktopModule(
		ChatService.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(dependencies),
		),
		(runtime) => {
			const selectionLock = Effect.runSync(Effect.makeSemaphore(1));
			const draftLifetime = new AbortController();
			const drafts = new Set<Promise<string>>();
			let drafting = false;
			let disposal: Promise<void> | undefined;
			const submit = Effect.fn("DesktopChat.submit")(
				(input: ChatInput, scope = "main", pinned?: PinnedDirectModel) =>
					selectionLock.withPermits(1)(
						Effect.gen(function* () {
							const selected =
								pinned ??
								(yield* Effect.gen(function* () {
									const rows = yield* options.models(scope);
									const row = rows.find((r) => r.role === "default");
									if (!row?.model.trim()) return yield* new AiConfigInvalid();
									if (!row.credentialRef) return yield* new AiAuthRequired();
									const profile = yield* Effect.try({
										try: () => profileFromModel(row),
										catch: (cause) => new AiConfigInvalid(cause),
									});
									return { profile, maxTokens: row.maxTokens };
								}));
							const { profile } = selected;
							yield* AiRepository.put(profile);
							return yield* ChatService.submit(OWNER, {
								...input,
								profileId: profile.id,
								modelId: profile.modelId,
								authGeneration: profile.authGeneration,
								mode: "normal",
								contextWindowTokens: 8192,
								// The model setting is an upper bound. Until context metadata is
								// available, reserve at most 1024 inside the conservative 8192 window.
								outputReserveTokens: Math.min(selected.maxTokens, 1024),
							});
						}),
					),
			);
			const publicHistory = (
				history: { readonly owner: string } & PublicChatHistory,
			): PublicChatHistory => {
				const { owner: _owner, ...value } = history;
				return value;
			};
			return {
				runtime,
				providers: Effect.fn("DesktopChat.providers")(function* () {
					const rows = yield* options.models("default");
					return yield* Effect.forEach(rows, (row) =>
						Effect.gen(function* () {
							const parsed = Either.try(() => profileMetadataFromModel(row));
							if (
								Either.isLeft(parsed) ||
								Either.isLeft(validateProfile(parsed.right))
							)
								return {
									id: row.id,
									provider: row.provider,
									modelId: row.model,
									available: false,
									directCapable: false,
									state: "invalid" as const,
									options: modelOptions(row.provider, [row.model]),
								};
							const reference = Schema.decodeUnknownEither(CredentialRef)(
								row.credentialRef,
							);
							const profile = {
								...parsed.right,
								...(Either.isRight(reference)
									? { credentialRef: reference.right }
									: {}),
							};
							const listing = localProviderListing(
								[profile],
								["openai-compatible", "coze", "xfy", "dashscope-media"],
							)[0];
							if (!listing) return yield* new AiConfigInvalid();
							const ready = profile.credentialRef
								? yield* Effect.isSuccess(
										options.credentials.resolve(
											profile.credentialRef,
											profile.authGeneration,
										),
									)
								: false;
							return {
								...listing,
								id: row.id,
								available: listing.available && ready,
								state: ready ? ("ready" as const) : ("needs-key" as const),
								directCapable:
									listing.directCapable &&
									ready &&
									resolveModelRows([row]).length === 1,
							};
						}),
					);
				}),
				file: Effect.fn("DesktopChat.file")(function* (
					input: unknown,
					ownedProfileId: ProfileId,
				) {
					const request = yield* Schema.decodeUnknown(PublicFileRequest, {
						onExcessProperty: "error",
					})(input).pipe(
						Effect.mapError((cause) => new AiConfigInvalid(cause)),
					);
					const rows = yield* options.models("default");
					const row = rows.find((row) => row.id === request.modelRowId);
					if (!row) return yield* new AiConfigInvalid();
					const profile = yield* Effect.try({
						try: () => profileFromModel(row),
						catch: (cause) => new AiConfigInvalid(cause),
					});
					if (profile.id !== ownedProfileId)
						return yield* new AiConfigInvalid();
					return yield* AiProviderService.file({
						requestId: request.requestId,
						profileId: profile.id,
						operation: request.operation,
					});
				}),
				submit,
				pinKnobModel: Effect.fn("DesktopChat.pinKnobModel")(function* (
					providerId: string,
					modelId: string,
				): Effect.fn.Return<PinnedDirectModel, VoiceKnobRejected> {
					const rows = yield* options
						.models("default")
						.pipe(
							Effect.mapError(
								(cause) => new VoiceKnobRejected("RouteIncomplete", cause),
							),
						);
					const matches = resolveModelRows(rows).filter(
						(r) =>
							r.id === providerId &&
							modelOptions(r.provider, [r.model]).some(
								(option) => option.id === modelId,
							),
					);
					const row = matches.length === 1 ? matches[0] : undefined;
					if (!row?.model.trim() || !row.credentialRef)
						return yield* new VoiceKnobRejected("RouteIncomplete");
					const profile = yield* Effect.try({
						try: () => profileFromModel({ ...row, model: modelId }),
						catch: (cause) => new VoiceKnobRejected("RouteIncomplete", cause),
					});
					if (Either.isLeft(validateProfile(profile)) || !profile.credentialRef)
						return yield* new VoiceKnobRejected("RouteIncomplete");
					yield* options.credentials
						.resolve(profile.credentialRef, profile.authGeneration)
						.pipe(
							Effect.mapError(
								(cause) => new VoiceKnobRejected("RouteIncomplete", cause),
							),
						);
					return { profile, maxTokens: row.maxTokens };
				}),
				draftShortcuts: (
					request: string,
					signal?: AbortSignal,
				): Promise<string> => {
					const operation = runtime
						.runPromiseExit(
							Effect.acquireUseRelease(
								Effect.suspend(() => {
									if (drafting || draftLifetime.signal.aborted)
										return Effect.fail(new AiUnavailable());
									drafting = true;
									return Effect.void;
								}),
								() => shortcutDraft(request, options.models, profileFromModel),
								() =>
									Effect.sync(() => {
										drafting = false;
									}),
							),
							{
								signal: signal
									? AbortSignal.any([signal, draftLifetime.signal])
									: draftLifetime.signal,
							},
						)
						.then((result) => {
							if (Exit.isFailure(result)) throw Cause.squash(result.cause);
							return result.value;
						});
					drafts.add(operation);
					void operation
						.finally(() => drafts.delete(operation))
						.catch(() => {});
					return operation;
				},
				subscribe: Effect.fn("DesktopChat.subscribe")(
					(sessionId: SessionId, turnId: TurnId) =>
						ChatService.subscribe(OWNER, sessionId, turnId),
				),
				snapshot: Effect.fn("DesktopChat.snapshot")(
					(sessionId: SessionId, turnId: TurnId) =>
						ChatService.snapshot(OWNER, sessionId, turnId),
				),
				cancel: Effect.fn("DesktopChat.cancel")(
					(sessionId: SessionId, turnId: TurnId) =>
						ChatService.cancel(OWNER, sessionId, turnId),
				),
				close: Effect.fn("DesktopChat.close")((sessionId: SessionId) =>
					ChatService.close(OWNER, sessionId),
				),
				clear: Effect.fn("DesktopChat.clear")((sessionId: SessionId) =>
					ChatService.clear(OWNER, sessionId),
				),
				rename: Effect.fn("DesktopChat.rename")(
					(sessionId: SessionId, title: string) =>
						ChatService.rename(OWNER, sessionId, title),
				),
				history: Effect.fn("DesktopChat.history")((sessionId: SessionId) =>
					ChatService.history(OWNER, sessionId).pipe(Effect.map(publicHistory)),
				),
				list: Effect.fn("DesktopChat.list")(() =>
					ChatService.list(OWNER).pipe(
						Effect.map((items) => items.map(publicHistory)),
					),
				),
				dispose: () => {
					if (disposal) return disposal;
					draftLifetime.abort();
					disposal = Promise.allSettled([...drafts]).then(() =>
						runtime.dispose(),
					);
					return disposal;
				},
			};
		},
		options.diagnostics,
		"chat.request",
	);
	return prepared;
}

export function createDirectChat(
	...args: Parameters<typeof prepareDirectChat>
) {
	return prepareDirectChat(...args).standalone();
}
export type DirectChat = ReturnType<typeof createDirectChat>;

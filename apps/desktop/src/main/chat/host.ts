import { createHash } from "node:crypto";
import { isIPv4 } from "node:net";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { AiCompatibleAdapter } from "../../../../../packages/edge/src/ai/adapters/adapter";
import { makeVercelCompatibleAdapter } from "../../../../../packages/edge/src/ai/adapters/vercel";
import type {
	CredentialRef,
	ProfileId,
	ProviderProfile,
} from "../../../../../packages/edge/src/ai/ai-contracts";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	AiAuthRequired,
	AiConfigInvalid,
	type AiError,
	AiUnavailable,
} from "../../../../../packages/edge/src/ai/ai-errors";
import { AiRepository } from "../../../../../packages/edge/src/ai/ai-repository";
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
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { shortcutDraft } from "./shortcut-draft";

const OWNER = "desktop-user";
/** Endpoint changes create a different profile. A turn never reads mutable renderer settings. */
export function profileFromModel(row: ModelRow): ProviderProfile {
	const hex = createHash("sha256")
		.update(
			JSON.stringify([
				row.id,
				row.provider,
				row.baseUrl,
				row.model,
				row.credentialRef,
			]),
		)
		.digest("hex");
	const id =
		`${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ProfileId;
	const url = new URL(row.baseUrl);
	const loopback =
		url.hostname === "localhost" ||
		url.hostname === "[::1]" ||
		(isIPv4(url.hostname) && url.hostname.startsWith("127."));
	return {
		version: 1,
		id,
		adapter: "openai-compatible",
		baseUrl: row.baseUrl,
		endpointPolicy: loopback ? "loopback" : "remote",
		modelId: row.model,
		provider:
			row.provider === "openai" ||
			row.provider === "qwen" ||
			row.provider === "kimi" ||
			row.provider === "deepseek"
				? row.provider
				: "generic",
		auth: "apiKey",
		credentialRef: Schema.decodeUnknownSync(Schema.UUID)(
			row.credentialRef,
		) as CredentialRef,
		authGeneration: 0,
		capabilities: {
			text: "supported",
			tools: "unsupported",
			images: "unsupported",
			imageGeneration: "unsupported",
			videoGeneration: "unsupported",
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
					makeVercelCompatibleAdapter(options.fetch),
				),
				Layer.succeed(AiCredentials, options.credentials),
			),
		),
	);
	const dependencies = Layer.mergeAll(
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
				(input: ChatInput, scope = "main") =>
					selectionLock.withPermits(1)(
						Effect.gen(function* () {
							const rows = yield* options.models(scope);
							const row = rows.find((r) => r.role === "default");
							if (!row?.model.trim()) return yield* new AiConfigInvalid();
							if (!row.credentialRef) return yield* new AiAuthRequired();
							const profile = yield* Effect.try({
								try: () => profileFromModel(row),
								catch: (cause) => new AiConfigInvalid(cause),
							});
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
								outputReserveTokens: Math.min(row.maxTokens, 1024),
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
				submit,
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

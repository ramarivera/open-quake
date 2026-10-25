import { createHash } from "node:crypto";
import { Effect, Layer, Schema } from "effect";
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
import { makeDesktopRuntime } from "../diagnostics/runtime";

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
		/^127\./.test(url.hostname);
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
		sampling: { maxOutputTokens: Math.min(row.maxTokens, 65536) },
		samplingLimits: { maxOutputTokens: Math.min(row.maxTokens, 65536) },
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
export function createDirectChat(options: DirectChatOptions) {
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
	const runtime = makeDesktopRuntime(
		ChatService.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(dependencies),
		),
		options.diagnostics,
		"chat.request",
	);
	const selectionLock = Effect.runSync(Effect.makeSemaphore(1));
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
		dispose: () => runtime.dispose(),
	};
}
export type DirectChat = ReturnType<typeof createDirectChat>;

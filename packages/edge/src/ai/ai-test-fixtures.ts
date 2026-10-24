import { Effect, Layer, Redacted, Schema } from "effect";
import {
	AiCompatibleAdapter,
	type CompatibleAdapter,
} from "./adapters/adapter.js";
import {
	CredentialRef,
	type InferenceRequest,
	type ProviderProfile,
} from "./ai-contracts.js";
import { AiCredentials } from "./ai-credentials.js";
import { AiRepository, MOCK_PROFILE } from "./ai-repository.js";
import { AiProviderService } from "./ai-service.js";
export const workflowProfile: ProviderProfile = {
	...MOCK_PROFILE,
	adapter: "openai-compatible",
	auth: "apiKey",
	provider: "qwen",
	credentialRef: Schema.decodeUnknownSync(CredentialRef)(
		"00000000-0000-4000-8000-000000000002",
	),
	models: {
		routing: "router",
		daily: "daily",
		deepThink: "deep",
		vision: "vision",
		image: "image",
		video: "video",
		tts: "speech",
	},
	samplingLimits: {
		maxOutputTokens: 16384,
		temperature: { min: 0, max: 2 },
		topP: { min: 0, max: 1 },
	},
};
export const workflowRequest: InferenceRequest = {
	profileId: workflowProfile.id,
	messages: [{ role: "user", content: [{ _tag: "text", text: "hello" }] }],
	requestedCapabilities: [],
	sampling: {},
};
export const workflowLayer = (
	adapter: CompatibleAdapter,
	credentials: typeof AiCredentials.Service = {
		resolve: () => Effect.succeed(Redacted.make("fixture-key")),
		revoked: () => Effect.never,
	},
) =>
	AiProviderService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(AiRepository.Default),
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiCompatibleAdapter, adapter),
				Layer.succeed(AiCredentials, credentials),
			),
		),
	);

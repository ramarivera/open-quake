import { Context, Effect, Layer, Option, Schema } from "effect";
import { AiCompatibleAdapter } from "../ai/adapters/adapter.js";
import { AiConnectivity } from "../ai/ai-connectivity.js";
import type { InferenceRequest, ProviderProfile } from "../ai/ai-contracts.js";
import { AiCredentials } from "../ai/ai-credentials.js";
import { AiConfigInvalid, type AiError } from "../ai/ai-errors.js";
import { AiRepository } from "../ai/ai-repository.js";
import { AiProviderService, type Generation } from "../ai/ai-service.js";
import { TurnSelection } from "./chat-contracts.js";

export const ChatSubmit = Schema.Struct({
	...TurnSelection.fields,
	contextTimeoutSeconds: Schema.optional(
		Schema.Int.pipe(Schema.between(5, 30)),
	),
	historyCount: Schema.optional(Schema.Int.pipe(Schema.between(0, 50))),
	text: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(32768)),
	systemPrompt: Schema.optional(Schema.String.pipe(Schema.maxLength(32768))),
	contextWindowTokens: Schema.optional(
		Schema.Int.pipe(Schema.between(32, 2097152)),
	),
	outputReserveTokens: Schema.optional(
		Schema.Int.pipe(Schema.between(1, 65536)),
	),
	modelRole: Schema.optional(Schema.Literal("daily", "deepThink")),
});
export type ChatSubmit = typeof ChatSubmit.Type;

/** This port still calls the real facade, with one immutable profile repository per turn. */
export class ChatInference extends Context.Tag(
	"@open-quake/edge/ChatInference",
)<
	ChatInference,
	{
		readonly open: (
			profile: ProviderProfile,
			request: InferenceRequest,
		) => Effect.Effect<Generation, AiError>;
	}
>() {}

export const ChatInferenceLive = Layer.effect(
	ChatInference,
	Effect.gen(function* () {
		const adapter = yield* Effect.serviceOption(AiCompatibleAdapter);
		const credentials = yield* Effect.serviceOption(AiCredentials);
		const connectivity = yield* Effect.serviceOption(AiConnectivity);
		let context = Context.empty();
		if (Option.isSome(connectivity))
			context = Context.add(context, AiConnectivity, connectivity.value);
		if (Option.isSome(adapter))
			context = Context.add(context, AiCompatibleAdapter, adapter.value);
		if (Option.isSome(credentials))
			context = Context.add(context, AiCredentials, credentials.value);
		return {
			open: Effect.fn("ChatInference.open")(
				(profile, request): Effect.Effect<Generation, AiError> => {
					const pinned = AiRepository.make({
						get: Effect.fn("PinnedAiRepository.get")((id) =>
							Effect.succeed(
								id === profile.id ? Option.some(profile) : Option.none(),
							),
						),
						put: Effect.fn("PinnedAiRepository.put")(() =>
							Effect.fail(new AiConfigInvalid()),
						),
					});
					const layer = AiProviderService.DefaultWithoutDependencies.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(AiRepository, pinned),
								Layer.succeedContext(context),
							),
						),
					);
					return AiProviderService.generate(request).pipe(
						Effect.provide(layer),
					);
				},
			),
		};
	}),
);

export { AiConnectivity } from "../ai/ai-connectivity.js";

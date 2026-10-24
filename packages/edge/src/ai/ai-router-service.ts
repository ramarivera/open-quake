import { Context, Effect, Either, Option, Schema, Stream } from "effect";
import {
	AiConfigInvalid,
	type AiError,
	AiProtocolInvalid,
	AiUnavailable,
} from "./ai-errors.js";
import { AiRepository } from "./ai-repository.js";
import {
	IntentDecision,
	type VoiceMode,
	VoiceRequest,
} from "./ai-router-contracts.js";
import { routerPrompt } from "./ai-router-prompt.js";
import { AiProviderService } from "./ai-service.js";

export interface VoiceDispatch {
	readonly request: VoiceRequest;
	readonly route: VoiceMode;
	readonly decision: Option.Option<IntentDecision>;
}
/** Owning lanes bind targets to their capability registry. Classification grants no permission. */
export class AiVoiceTargets extends Context.Tag(
	"@open-quake/edge/AiVoiceTargets",
)<
	AiVoiceTargets,
	{
		readonly dispatch: (
			input: VoiceDispatch,
		) => Effect.Effect<{ readonly operationId: string }, AiError>;
	}
>() {}
export function intentRoute(decision: IntentDecision): VoiceMode {
	switch (decision.userRequestAction) {
		case "operatingComputer":
			return "operatePC";
		case "generateConfiguration":
			return "keyConfig";
		case "operatingEquipment":
			return "operateEquipment";
		case "generateWallpaper":
			return decision.requestExtra?.extraData === "video"
				? "videoGeneration"
				: "pictureGeneration";
		case "analysisUserData":
			return "dataAnalysis";
		case "operateAgent":
			return "agents";
		case "runShortcut":
			return "shortcuts";
		case "meeting":
			return "meetings";
		case "standardChat":
			return "normal";
	}
}
export class AiVoiceService extends Effect.Service<AiVoiceService>()(
	"@open-quake/edge/AiVoiceService",
	{
		accessors: true,
		dependencies: [AiProviderService.Default],
		effect: Effect.gen(function* () {
			const providers = yield* AiProviderService;
			const repository = yield* AiRepository;
			const targets = yield* Effect.serviceOption(AiVoiceTargets);
			return {
				submit: Effect.fn("AiVoiceService.submit")(function* (
					input: unknown,
				): Effect.fn.Return<
					{ readonly route: VoiceMode; readonly operationId: string },
					AiError
				> {
					const decoded = Schema.decodeUnknownEither(VoiceRequest, {
						onExcessProperty: "error",
					})(input);
					if (Either.isLeft(decoded))
						return yield* new AiConfigInvalid(decoded.left);
					const request = decoded.right;
					if (Option.isNone(targets)) return yield* new AiUnavailable();
					let route =
						request.mode === "auto" ? request.sessionRoute : request.mode;
					let decision: Option.Option<IntentDecision> = Option.none();
					if (!route) {
						const generation = yield* providers.generate({
							profileId: request.profileId,
							modelRole: "routing",
							controls: { thinking: false, webSearch: false },
							sampling: { maxOutputTokens: 2048 },
							requestedCapabilities: [],
							messages: [
								{
									role: "system",
									content: [
										{
											_tag: "text",
											text: routerPrompt(request.homeAssistantEnabled),
										},
									],
								},
								{
									role: "user",
									content: [{ _tag: "text", text: request.text }],
								},
							],
						});
						const text = yield* Stream.runFoldEffect(
							generation.events,
							"",
							(text, event) => {
								const next =
									text + (event._tag === "textDelta" ? event.textDelta : "");
								return next.length > 16384
									? Effect.fail(new AiProtocolInvalid())
									: Effect.succeed(next);
							},
						).pipe(
							Effect.timeoutFail({
								duration: "300 seconds",
								onTimeout: () => new AiUnavailable(),
							}),
							Effect.ensuring(generation.cancel()),
						);
						const parsed = Schema.decodeUnknownEither(
							Schema.parseJson(IntentDecision),
							{ onExcessProperty: "error" },
						)(text.trim());
						if (Either.isLeft(parsed))
							return yield* new AiProtocolInvalid(parsed.left);
						const profile = yield* repository.get(request.profileId);
						const searchAllowed =
							Option.isSome(profile) &&
							profile.value.controls?.webSearch === true;
						decision = Option.some({
							...parsed.right,
							searchOptions: {
								...parsed.right.searchOptions,
								shouldDoWebSearch:
									parsed.right.searchOptions.shouldDoWebSearch && searchAllowed,
							},
						});
						route = intentRoute(parsed.right);
					}
					if (route === "operateEquipment" && !request.homeAssistantEnabled)
						return yield* new AiConfigInvalid();
					const result = yield* targets.value.dispatch({
						request,
						route,
						decision,
					});
					return { route, operationId: result.operationId };
				}),
			};
		}),
	},
) {}

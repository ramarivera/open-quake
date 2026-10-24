import { Effect, Option, Stream } from "effect";
import { AiRepository } from "../ai/ai-repository.js";
import { AiProviderService } from "../ai/ai-service.js";
import type {
	MeetingConfig,
	Segment,
	TemplateId,
} from "./meeting-contracts.js";
import { type MeetingError, meetingError } from "./meeting-errors.js";
import { transcriptText } from "./meeting-invariants.js";
import { summaryPrompt } from "./meeting-templates.js";

export class MeetingProvider extends Effect.Service<MeetingProvider>()(
	"@open-quake/edge/MeetingProvider",
	{
		accessors: true,
		dependencies: [AiProviderService.Default, AiRepository.Default],
		effect: Effect.gen(function* () {
			const facade = yield* AiProviderService;
			const profiles = yield* AiRepository;
			return {
				requireTranslation: facade.requireMeetingTranslation,
				transcribe: facade.transcribeMeeting,
				translate: facade.translateMeeting,
				stopTranslation: facade.stopMeetingTranslation,
				summarize: Effect.fn("MeetingProvider.summarize")(function* (
					config: MeetingConfig,
					transcript: readonly Segment[],
					template: TemplateId,
				): Effect.fn.Return<string, MeetingError> {
					const profile = yield* profiles.get(config.profileId);
					if (
						Option.isNone(profile) ||
						profile.value.modelId !== config.minutesModel
					)
						return yield* meetingError("Unavailable");
					const generation = yield* facade
						.generate({
							profileId: config.profileId,
							messages: [
								{
									role: "system",
									content: [
										{
											_tag: "text",
											text: summaryPrompt(template, config.outputLanguage),
										},
									],
								},
								{
									role: "user",
									content: [{ _tag: "text", text: transcriptText(transcript) }],
								},
							],
							requestedCapabilities: ["text"],
							sampling: {},
						})
						.pipe(
							Effect.mapError((cause) =>
								meetingError("GenerationFailed", cause),
							),
						);
					const text = yield* generation.events.pipe(
						Stream.runFold("", (result, event) =>
							event._tag === "textDelta" ? result + event.textDelta : result,
						),
						Effect.timeoutFail({
							duration: "5 minutes",
							onTimeout: () => meetingError("Timeout"),
						}),
						Effect.mapError((cause) => meetingError("GenerationFailed", cause)),
						Effect.ensuring(generation.cancel()),
					);
					const clean = text
						.trim()
						.replace(/^```(?:markdown|md)?\s*\n/i, "")
						.replace(/\n```$/, "");
					if (!clean) return yield* meetingError("GenerationFailed");
					return clean;
				}),
			};
		}),
	},
) {}

import { Deferred, Effect, Either, Option, Ref, Schema, Stream } from "effect";
import type { MeetingConfig } from "../meetings/meeting-contracts.js";
import { meetingError } from "../meetings/meeting-errors.js";
import { AiCompatibleAdapter } from "./adapters/adapter.js";
import { AiFileAdapter } from "./adapters/files.js";
import { mockEvents } from "./adapters/mock.js";
import { AiConnectivity } from "./ai-connectivity.js";
import {
	InferenceRequest,
	NormalizedEvent,
	type ProviderProfile,
} from "./ai-contracts.js";
import { AiCredentials } from "./ai-credentials.js";
import {
	AiAuthRequired,
	AiCapabilityUnsupported,
	AiConfigInvalid,
	type AiError,
	AiOffline,
	AiProtocolInvalid,
	AiUnavailable,
} from "./ai-errors.js";
import { FileRequest, type FileResult } from "./ai-file-contracts.js";
import { generationDeadlineMs, validateRequest } from "./ai-invariants.js";
import { prepareWorkflow } from "./ai-provider-quirks.js";
import { AiRepository } from "./ai-repository.js";
import { selectRole } from "./ai-role-presets.js";
import type { ProviderOptions } from "./ai-workflow-contracts.js";
import { AiMeetingAdapter, transcribeMeeting } from "./meeting-adapter.js";
import type { GeneratedAudio } from "./speech/speech-contracts.js";
import {
	AiSpeechService,
	type SpeechFailure,
	type SpeechTurn,
} from "./speech/speech-service.js";

export interface Generation {
	/** One subscriber. ChatService owns authoritative assembly and fan-out. */
	readonly events: Stream.Stream<NormalizedEvent, AiError>;
	readonly cancel: () => Effect.Effect<void>;
}

type RegisteredAdapter = (input: {
	readonly profile: ProviderProfile;
	readonly request: InferenceRequest;
	readonly providerOptions: ProviderOptions;
	readonly signal: AbortSignal;
}) => Effect.Effect<Stream.Stream<NormalizedEvent, AiError>, AiError>;

/** Require one terminal and stop pulling upstream immediately after it. */
function normalized(
	source: Stream.Stream<NormalizedEvent, AiError>,
): Stream.Stream<NormalizedEvent, AiError> {
	return Stream.unwrap(
		Effect.gen(function* () {
			const completed = yield* Ref.make(false);
			let visibleText = false;
			return source.pipe(
				Stream.mapEffect(
					(input): Effect.Effect<NormalizedEvent, AiProtocolInvalid> => {
						const decoded = Schema.decodeUnknownEither(NormalizedEvent, {
							onExcessProperty: "error",
						})(input);
						if (Either.isLeft(decoded))
							return Effect.fail(new AiProtocolInvalid(decoded.left));
						if (
							decoded.right._tag === "textDelta" &&
							decoded.right.textDelta.trim()
						)
							visibleText = true;
						if (decoded.right._tag === "completed" && !visibleText)
							return Effect.fail(new AiProtocolInvalid());
						return decoded.right._tag === "completed"
							? Ref.set(completed, true).pipe(Effect.as(decoded.right))
							: Effect.succeed(decoded.right);
					},
				),
				Stream.takeUntil((event) => event._tag === "completed"),
				Stream.concat(
					Stream.unwrap(
						Ref.get(completed).pipe(
							Effect.map((done) =>
								done ? Stream.empty : Stream.fail(new AiProtocolInvalid()),
							),
						),
					),
				),
			);
		}),
	);
}

export class AiProviderService extends Effect.Service<AiProviderService>()(
	"@open-quake/edge/AiProviderService",
	{
		accessors: true,
		dependencies: [AiRepository.Default, AiSpeechService.Default],
		effect: Effect.gen(function* () {
			const repository = yield* AiRepository;
			const meetingAdapter = yield* Effect.serviceOption(AiMeetingAdapter);
			const compatible = yield* Effect.serviceOption(AiCompatibleAdapter);
			const credentials = yield* Effect.serviceOption(AiCredentials);
			const files = yield* Effect.serviceOption(AiFileAdapter);
			const connectivity = yield* Effect.serviceOption(AiConnectivity);
			const speech = yield* Effect.serviceOption(AiSpeechService);
			const adapters = new Map<ProviderProfile["adapter"], RegisteredAdapter>([
				["mock", () => Effect.succeed(mockEvents())],
			]);
			if (Option.isSome(compatible)) {
				const adapter = compatible.value;
				for (const kind of [
					"openai-compatible",
					"coze",
					"xfy",
					"dashscope-media",
				] as const)
					adapters.set(
						kind,
						Effect.fn("AiProviderService.openCompatible")(function* ({
							profile,
							request,
							providerOptions,
							signal,
						}: Parameters<RegisteredAdapter>[0]): Effect.fn.Return<
							Stream.Stream<NormalizedEvent, AiError>,
							AiError
						> {
							if (!profile.credentialRef || Option.isNone(credentials))
								return yield* new AiAuthRequired();
							const credential = yield* credentials.value.resolve(
								profile.credentialRef,
								profile.authGeneration,
							);
							return yield* adapter.open({
								profile,
								request,
								providerOptions,
								signal,
								credential,
								redirectPolicy: "error",
								maxRetries: 0,
							});
						}),
					);
			}
			return {
				file: Effect.fn("AiProviderService.file")(function* (
					input: unknown,
				): Effect.fn.Return<typeof FileResult.Type, AiError> {
					const request = yield* Schema.decodeUnknown(FileRequest, {
						onExcessProperty: "error",
					})(input).pipe(
						Effect.mapError((cause) => new AiConfigInvalid(cause)),
					);
					const selected = yield* repository.get(request.profileId);
					if (Option.isNone(selected)) return yield* new AiConfigInvalid();
					const profile = selected.value;
					if (
						!profile.settings?.filesEnabled ||
						profile.adapter !== "openai-compatible" ||
						(profile.provider !== "openai" && profile.provider !== "qwen")
					)
						return yield* new AiConfigInvalid();
					if (Option.isNone(files)) return yield* new AiUnavailable();
					if (!profile.credentialRef || Option.isNone(credentials))
						return yield* new AiAuthRequired();
					if (
						profile.endpointPolicy === "remote" &&
						Option.isSome(connectivity) &&
						!(yield* connectivity.value.online())
					)
						return yield* new AiOffline();
					const credentialRef = profile.credentialRef;
					const controller = new AbortController();
					return yield* Effect.gen(function* () {
						const credential = yield* credentials.value.resolve(
							credentialRef,
							profile.authGeneration,
						);
						return yield* files.value
							.execute(profile, request, credential, controller.signal)
							.pipe(
								Effect.timeoutFail({
									duration: "60 seconds",
									onTimeout: () => new AiUnavailable(),
								}),
							);
					}).pipe(
						Effect.raceFirst(
							credentials.value.revoked(
								profile.credentialRef,
								profile.authGeneration,
							),
						),
						Effect.ensuring(Effect.sync(() => controller.abort())),
					);
				}),
				requireMeetingTranslation: () =>
					Option.isSome(meetingAdapter)
						? Effect.void
						: Effect.fail(meetingError("Unavailable")),
				transcribeMeeting: (
					config: MeetingConfig,
					audioRef: string,
					durationMs: number,
					progress?: (stage: 2 | 3, status: 1 | 2) => Effect.Effect<void>,
				) =>
					transcribeMeeting(
						meetingAdapter,
						config,
						audioRef,
						durationMs,
						progress,
					),
				translateMeeting: Effect.fn("AiProviderService.translateMeeting")(
					(config: MeetingConfig, pcm: Uint8Array) =>
						Option.isSome(meetingAdapter)
							? meetingAdapter.value.translate(config, pcm)
							: Effect.fail(meetingError("Unavailable")),
				),
				stopMeetingTranslation: Effect.fn(
					"AiProviderService.stopMeetingTranslation",
				)(() =>
					Option.isSome(meetingAdapter)
						? meetingAdapter.value.stopTranslation()
						: Effect.void,
				),
				synthesize: Effect.fn("AiProviderService.synthesize")(
					(
						...args: Parameters<AiSpeechService["synthesize"]>
					): Effect.Effect<GeneratedAudio, SpeechFailure> =>
						Option.isSome(speech)
							? speech.value.synthesize(...args)
							: Effect.fail(new AiUnavailable()),
				),
				createSpeech: Effect.fn("AiProviderService.createSpeech")(
					(
						...args: Parameters<AiSpeechService["createSpeech"]>
					): Effect.Effect<SpeechTurn, AiUnavailable> =>
						Option.isSome(speech)
							? speech.value.createSpeech(...args)
							: Effect.fail(new AiUnavailable()),
				),
				recognize: Effect.fn("AiProviderService.recognize")(
					(
						...args: Parameters<AiSpeechService["recognize"]>
					): ReturnType<AiSpeechService["recognize"]> =>
						Option.isSome(speech)
							? speech.value.recognize(...args)
							: Effect.fail(new AiUnavailable()),
				),
				generate: Effect.fn("AiProviderService.generate")(function* (
					input: unknown,
				): Effect.fn.Return<Generation, AiError> {
					const decoded = Schema.decodeUnknownEither(InferenceRequest, {
						onExcessProperty: "error",
					})(input);
					if (Either.isLeft(decoded))
						return yield* new AiConfigInvalid(decoded.left);
					const stored = yield* repository.get(decoded.right.profileId);
					if (Option.isNone(stored)) return yield* new AiConfigInvalid();
					const profile = stored.value;
					const validated = validateRequest(profile, decoded.right);
					if (Either.isLeft(validated))
						return yield* validated.left.reason === "capability"
							? new AiCapabilityUnsupported(validated.left.capability)
							: new AiConfigInvalid();
					let request = validated.right;
					if (request.persona) {
						const persona = request.persona;
						const selected =
							persona.roleId === -1
								? Either.right({ systemPrompt: persona.customPrompt ?? "" })
								: selectRole(persona.roleId, persona.locale);
						if (Either.isLeft(selected)) return yield* selected.left;
						request = {
							...request,
							messages: [
								{
									role: "system",
									content: [
										{ _tag: "text", text: selected.right.systemPrompt },
									],
								},
								...request.messages,
							],
						};
					}
					const prepared = prepareWorkflow(profile, request);
					if (Either.isLeft(prepared)) return yield* prepared.left;
					const checked = validateRequest(
						prepared.right.profile,
						prepared.right.request,
					);
					if (Either.isLeft(checked)) return yield* new AiConfigInvalid();
					const adapter = adapters.get(profile.adapter);
					if (!adapter) return yield* new AiUnavailable();
					if (
						["openai-compatible", "coze", "xfy", "dashscope-media"].includes(
							profile.adapter,
						) &&
						(!profile.credentialRef || Option.isNone(credentials))
					)
						return yield* new AiAuthRequired();
					const cancelled = yield* Deferred.make<void>();
					const consumed = yield* Ref.make(false);
					const controller = new AbortController();
					const cancel = Effect.fn("AiProviderService.cancel")(
						(): Effect.Effect<void> =>
							Effect.sync(() => controller.abort()).pipe(
								Effect.zipRight(Deferred.succeed(cancelled, undefined)),
								Effect.asVoid,
							),
					);
					const events = Stream.unwrapScoped(
						Effect.gen(function* () {
							if (yield* Ref.getAndSet(consumed, true))
								return Stream.fail(new AiProtocolInvalid());
							yield* Effect.addFinalizer(() =>
								Effect.sync(() => controller.abort()),
							);
							if (controller.signal.aborted) return Stream.empty;
							if (
								profile.adapter !== "mock" &&
								profile.endpointPolicy === "remote" &&
								Option.isSome(connectivity) &&
								!(yield* connectivity.value.online())
							)
								return yield* new AiOffline();
							const source = yield* adapter({
								...prepared.right,
								signal: controller.signal,
							});
							return normalized(source);
						}),
					).pipe(
						Stream.interruptWhen(
							profile.credentialRef && Option.isSome(credentials)
								? credentials.value.revoked(
										profile.credentialRef,
										profile.authGeneration,
									)
								: Effect.never,
						),
						Stream.interruptWhen(Deferred.await(cancelled)),
						Stream.interruptWhen(
							Effect.sleep(generationDeadlineMs(profile)).pipe(
								Effect.zipRight(Effect.fail(new AiUnavailable())),
							),
						),
						Stream.withSpan("AiProviderService.stream"),
					);
					return { events, cancel };
				}),
			};
		}),
	},
) {}

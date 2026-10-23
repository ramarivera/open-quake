import { Deferred, Effect, Either, Option, Ref, Schema, Stream } from "effect";
import { AiCompatibleAdapter } from "./adapters/adapter.js";
import { mockEvents } from "./adapters/mock.js";
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
	AiProtocolInvalid,
	AiUnavailable,
} from "./ai-errors.js";
import { validateRequest } from "./ai-invariants.js";
import { AiRepository } from "./ai-repository.js";

export interface Generation {
	/** One subscriber. ChatService owns authoritative assembly and fan-out. */
	readonly events: Stream.Stream<NormalizedEvent, AiError>;
	readonly cancel: () => Effect.Effect<void>;
}

type RegisteredAdapter = (input: {
	readonly profile: ProviderProfile;
	readonly request: InferenceRequest;
	readonly signal: AbortSignal;
}) => Effect.Effect<Stream.Stream<NormalizedEvent, AiError>, AiError>;

/** Require one terminal and stop pulling upstream immediately after it. */
function normalized(
	source: Stream.Stream<NormalizedEvent, AiError>,
): Stream.Stream<NormalizedEvent, AiError> {
	return Stream.unwrap(
		Effect.gen(function* () {
			const completed = yield* Ref.make(false);
			return source.pipe(
				Stream.mapEffect(
					(input): Effect.Effect<NormalizedEvent, AiProtocolInvalid> => {
						const decoded = Schema.decodeUnknownEither(NormalizedEvent, {
							onExcessProperty: "error",
						})(input);
						if (Either.isLeft(decoded))
							return Effect.fail(new AiProtocolInvalid(decoded.left));
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
		dependencies: [AiRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* AiRepository;
			const compatible = yield* Effect.serviceOption(AiCompatibleAdapter);
			const credentials = yield* Effect.serviceOption(AiCredentials);
			const adapters = new Map<ProviderProfile["adapter"], RegisteredAdapter>([
				["mock", () => Effect.succeed(mockEvents())],
			]);
			if (Option.isSome(compatible)) {
				const adapter = compatible.value;
				adapters.set(
					"openai-compatible",
					Effect.fn("AiProviderService.openCompatible")(function* ({
						profile,
						request,
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
							signal,
							credential,
							redirectPolicy: "error",
							maxRetries: 0,
						});
					}),
				);
			}
			return {
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
					const adapter = adapters.get(profile.adapter);
					if (!adapter) return yield* new AiUnavailable();
					if (
						profile.adapter === "openai-compatible" &&
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
							const source = yield* adapter({
								profile,
								request: validated.right,
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
						Stream.withSpan("AiProviderService.stream"),
					);
					return { events, cancel };
				}),
			};
		}),
	},
) {}

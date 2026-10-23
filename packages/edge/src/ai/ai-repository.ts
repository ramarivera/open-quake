import { Effect, Either, Option, Ref } from "effect";
import {
	MOCK_CAPABILITIES,
	type ProfileId,
	type ProviderProfile,
} from "./ai-contracts.js";
import { AiConfigInvalid } from "./ai-errors.js";
import { validateProfile } from "./ai-invariants.js";

function immutableProfile(profile: ProviderProfile): ProviderProfile {
	Object.freeze(profile.capabilities);
	Object.freeze(profile.sampling);
	for (const range of [
		profile.samplingLimits.temperature,
		profile.samplingLimits.topP,
	])
		if (range) Object.freeze(range);
	Object.freeze(profile.samplingLimits);
	return Object.freeze(profile);
}

export const MOCK_PROFILE: ProviderProfile = immutableProfile({
	version: 1,
	id: "00000000-0000-4000-8000-000000000001" as ProfileId,
	adapter: "mock",
	baseUrl: "https://mock.invalid/v1",
	endpointPolicy: "remote",
	modelId: "deterministic-text-v1",
	auth: "none",
	authGeneration: 0,
	capabilities: MOCK_CAPABILITIES,
	sampling: {},
	samplingLimits: {},
});

/** Explicitly volatile metadata repository. Disk persistence belongs to the host. */
export class AiRepository extends Effect.Service<AiRepository>()(
	"@open-quake/edge/AiRepository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const profiles = yield* Ref.make<ReadonlyMap<ProfileId, ProviderProfile>>(
				new Map([[MOCK_PROFILE.id, MOCK_PROFILE]]),
			);
			return {
				get: Effect.fn("AiRepository.get")(
					(id: ProfileId): Effect.Effect<Option.Option<ProviderProfile>> =>
						Ref.get(profiles).pipe(
							Effect.map((all) => Option.fromNullable(all.get(id))),
						),
				),
				put: Effect.fn("AiRepository.put")(
					(input: unknown): Effect.Effect<void, AiConfigInvalid> => {
						const result = validateProfile(input);
						if (Either.isLeft(result))
							return Effect.fail(new AiConfigInvalid());
						// Decoding creates a fresh graph; freeze it so accepted snapshots cannot be mutated.
						const profile = immutableProfile(result.right);
						return Ref.update(profiles, (all) =>
							new Map(all).set(profile.id, profile),
						);
					},
				),
			};
		}),
	},
) {}

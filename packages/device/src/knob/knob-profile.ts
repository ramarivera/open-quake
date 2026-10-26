import { Effect, Either, Option, Schema } from "effect";
import {
	Profile,
	type ProfileEnvelope,
} from "../profiles/profile-contracts.js";
import {
	type ProfileRepositoryError,
	ProfileValidationFailed,
} from "../profiles/profile-errors.js";
import { ProfileService } from "../profiles/profile-service.js";
import { KnobResource } from "./knob-contracts.js";
import { validateKnobResource } from "./knob-invariants.js";

/** Read committed data in main; renderer drafts never supply unrelated profile fields. */
export const saveProfileKnob = Effect.fn("Knob.saveProfile")(function* (
	profileId: string,
	expectedRevision: number,
	input: unknown,
): Effect.fn.Return<ProfileEnvelope, ProfileRepositoryError, ProfileService> {
	const validated = validateKnobResource(input);
	if (Either.isLeft(validated))
		return yield* ProfileValidationFailed.fromCause(validated.left, [["knob"]]);
	const profiles = yield* ProfileService;
	const profile = yield* profiles.getProfile(profileId);
	const encoded = Schema.encodeSync(Profile)(profile);
	const { revision: _revision, ...draft } = encoded;
	return yield* profiles.saveProfile({
		expectedRevision,
		profile: {
			...draft,
			...(encoded.knob && !encoded.compatibility?.knobImportBackup
				? {
						compatibility: {
							...encoded.compatibility,
							knobImportBackup: encoded.knob,
						},
					}
				: {}),
			knob: Schema.encodeSync(KnobResource)(validated.right),
		},
	});
});

export const committedKnob = (profile: Profile): Option.Option<KnobResource> =>
	Option.flatMap(profile.knob, (knob) =>
		Option.getRight(validateKnobResource(knob)),
	);

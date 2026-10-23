import { Effect, Schema, type Stream } from "effect";
import { profileParseFailure } from "./profile-codec.js";
import {
	Profile,
	type ProfileEnvelope,
	ProfileRevision,
} from "./profile-contracts.js";
import {
	ProfileNotFound,
	type ProfileRepositoryError,
} from "./profile-errors.js";
import { ProfileFunctionContracts } from "./profile-function-contracts.js";
import {
	type ProfileLoadResult,
	ProfileRepository,
} from "./profile-repository.js";

export const ProfileDraft = Profile.pipe(Schema.omit("revision"));
export const SaveProfileRequest = Schema.Struct({
	expectedRevision: ProfileRevision,
	profile: ProfileDraft,
});
export type SaveProfileRequest = typeof SaveProfileRequest.Encoded;

export class ProfileService extends Effect.Service<ProfileService>()(
	"@open-quake/device/ProfileService",
	{
		accessors: true,
		dependencies: [ProfileRepository.Default, ProfileFunctionContracts.Default],
		effect: Effect.gen(function* () {
			const repository = yield* ProfileRepository;
			const functions = yield* ProfileFunctionContracts;
			return {
				loadProfiles: Effect.fn("ProfileService.loadProfiles")(
					(): Effect.Effect<ProfileLoadResult, ProfileRepositoryError> =>
						repository.load(),
				),
				getProfile: Effect.fn("ProfileService.getProfile")(function* (
					id: string,
				): Effect.fn.Return<Profile, ProfileRepositoryError> {
					const { envelope } = yield* repository.load();
					const profile = envelope.profiles.find((entry) => entry.id === id);
					return profile ?? (yield* ProfileNotFound.fromCause(undefined));
				}),
				saveProfile: Effect.fn("ProfileService.saveProfile")(function* (
					request: unknown,
				): Effect.fn.Return<ProfileEnvelope, ProfileRepositoryError> {
					const input = yield* Schema.decodeUnknown(SaveProfileRequest)(
						request,
						{ onExcessProperty: "error" },
					).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
					);
					const profile = {
						...input.profile,
						revision: input.expectedRevision + 1,
					};
					yield* functions.validateProfile(profile);
					return yield* repository.save(profile, input.expectedRevision);
				}),
				subscribeCommittedProfiles: Effect.fn(
					"ProfileService.subscribeCommittedProfiles",
				)(
					(): Effect.Effect<Stream.Stream<ProfileEnvelope>> =>
						Effect.succeed(repository.snapshots),
				),
			};
		}),
	},
) {}

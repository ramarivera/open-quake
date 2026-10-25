import { Effect, type Stream } from "effect";
import type { Profile, ProfileEnvelope } from "./profile-contracts.js";
import {
	ProfileNotFound,
	type ProfileRepositoryError,
	type ProfileValidationFailed,
} from "./profile-errors.js";
import {
	type ProfileCommitGuard,
	type ProfileLoadResult,
	ProfileRepository,
} from "./profile-repository.js";

export { ProfileDraft, SaveProfileRequest } from "./profile-contracts.js";

export class ProfileService extends Effect.Service<ProfileService>()(
	"@open-quake/device/ProfileService",
	{
		accessors: true,
		dependencies: [ProfileRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* ProfileRepository;
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
				saveProfile: Effect.fn("ProfileService.saveProfile")(
					(
						request: unknown,
					): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
						repository.save(request),
				),
				selectProfile: Effect.fn("ProfileService.selectProfile")(
					(
						request: unknown,
						guard?: ProfileCommitGuard,
					): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
						repository.select(request, guard),
				),
				subscribeCommittedProfiles: Effect.fn(
					"ProfileService.subscribeCommittedProfiles",
				)(
					(): Effect.Effect<Stream.Stream<ProfileEnvelope>> =>
						Effect.succeed(repository.snapshots),
				),
				subscribeDispatchProfiles: Effect.fn(
					"ProfileService.subscribeDispatchProfiles",
				)(
					(): Effect.Effect<
						Stream.Stream<ProfileEnvelope, ProfileValidationFailed>
					> => Effect.succeed(repository.dispatchSnapshots),
				),
			};
		}),
	},
) {}

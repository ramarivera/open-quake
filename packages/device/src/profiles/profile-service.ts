import { Effect, Option, Schema, type Stream } from "effect";
import { actionProfileFunctionContracts } from "../actions/profile-function-contracts.js";
import { Profile, type ProfileEnvelope } from "./profile-contracts.js";
import {
	ProfileNotFound,
	type ProfileRepositoryError,
	ProfileValidationFailed,
} from "./profile-errors.js";
import type { ProfileFunctionContract } from "./profile-function-contracts.js";
import { inspectProfileText } from "./profile-import.js";
import { editProfilePages, type PageEdit } from "./profile-pages.js";
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
				importProfile: Effect.fn("ProfileService.importProfile")(
					(
						text: string,
						id: string,
						contracts: ReadonlyMap<
							string,
							ProfileFunctionContract
						> = actionProfileFunctionContracts,
					): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
						repository.transact((envelope) =>
							Effect.gen(function* () {
								const report = inspectProfileText(text, contracts);
								if (
									!report.profile ||
									envelope.profiles.some((p) => p.id === id) ||
									envelope.profiles.length >= 30
								)
									return yield* ProfileValidationFailed.fromCause(undefined);
								const decoded = yield* Schema.decodeUnknown(Profile)({
									...report.profile,
									id,
									revision: 0,
									pages: report.profile.pages.map((page, i) => ({
										...page,
										id: `${id}-page-${i + 1}`,
									})),
								}).pipe(
									Effect.catchTag("ParseError", (cause) =>
										Effect.fail(ProfileValidationFailed.fromCause(cause)),
									),
								);
								return {
									...envelope,
									profiles: [...envelope.profiles, decoded] as const,
									manager: Option.map(envelope.manager, (manager) => ({
										...manager,
										revision: manager.revision + 1,
									})),
								};
							}),
						),
				),
				editPages: Effect.fn("ProfileService.pages")(
					(
						request: PageEdit,
					): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
						repository.transact((envelope) =>
							editProfilePages(envelope, request),
						),
				),
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

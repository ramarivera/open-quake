import { Effect, Option, Schema } from "effect";
import { profileParseFailure } from "./profile-codec.js";
import type { ProfileEnvelope } from "./profile-contracts.js";
import type { ProfileRepositoryError } from "./profile-errors.js";
import {
	ManagerCommand,
	type ProfilePlatform,
} from "./profile-manager-contracts.js";
import {
	applyManagerCommand,
	installProfileCatalog,
	type ManagerRejection,
} from "./profile-manager-invariants.js";
import { ProfileRepository } from "./profile-repository.js";

export type ManagerResult =
	| { readonly _tag: "updated"; readonly envelope: ProfileEnvelope }
	| { readonly _tag: "rejected"; readonly reason: ManagerRejection };
export class ProfileManager extends Effect.Service<ProfileManager>()(
	"@open-quake/device/ProfileManager",
	{
		accessors: true,
		dependencies: [ProfileRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* ProfileRepository;
			return {
				install: Effect.fn("ProfileManager.install")(
					(
						platform: ProfilePlatform,
					): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
						repository.transact((envelope) =>
							Effect.succeed(installProfileCatalog(envelope, platform)),
						),
				),
				read: Effect.fn("ProfileManager.read")(
					(): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
						repository.load().pipe(Effect.map((r) => r.envelope)),
				),
				command: Effect.fn("ProfileManager.command")(function* <E = never>(
					input: unknown,
					prepare?: (
						envelope: ProfileEnvelope,
					) => Effect.Effect<ProfileEnvelope, E>,
				): Effect.fn.Return<ManagerResult, ProfileRepositoryError | E> {
					const command = yield* Schema.decodeUnknown(ManagerCommand)(input, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
					);
					let rejection: Option.Option<ManagerRejection> = Option.none();
					const envelope = yield* repository.transact((current) => {
						const result = applyManagerCommand(current, command);
						if (result._tag === "rejected") {
							rejection = Option.some(result.reason);
							return Effect.succeed(current);
						}
						return prepare
							? prepare(result.envelope)
							: Effect.succeed(result.envelope);
					});
					return Option.match(rejection, {
						onNone: (): ManagerResult => ({ _tag: "updated", envelope }),
						onSome: (reason): ManagerResult => ({ _tag: "rejected", reason }),
					});
				}),
			};
		}),
	},
) {}

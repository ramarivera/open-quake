import { Effect, Array as EffectArray, Layer, Option } from "effect";
import { profileParseFailure } from "./profile-codec.js";
import type {
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "./profile-contracts.js";
import { ProfileValidationFailed } from "./profile-errors.js";
import { committedProfileSnapshot } from "./profile-snapshots.js";

/** The actions lane supplies validators. This module never dispatches actions. */
export interface ProfileFunctionContract {
	readonly childrenName: string;
	readonly supportsKnob: boolean;
	readonly supportsAlternateVisuals: boolean;
	readonly validateConfig: (
		config: ProfileKey["config"],
	) => readonly (readonly (string | number)[])[];
}

export const isUnsupportedProfileKey = (key: ProfileKey): boolean =>
	Option.isSome(key.compatibility) &&
	key.compatibility.value.unsupported === true;

const makeValidation = (
	contracts: ReadonlyMap<string, ProfileFunctionContract>,
) => {
	const validateProfile = Effect.fn("ProfileFunctionContracts.validateProfile")(
		(profile: Profile): Effect.Effect<void, ProfileValidationFailed> =>
			Effect.try({
				try: () => {
					const paths: (readonly (string | number)[])[] = [];
					profile.pages.forEach((page, pageIndex) => {
						page.keys.forEach((key, keyIndex) => {
							if (key.config.type === "" || isUnsupportedProfileKey(key))
								return;
							const path = ["pages", pageIndex, "keys", keyIndex];
							const contract = contracts.get(key.config.type);
							if (!contract) {
								paths.push([...path, "config", "type"]);
								return;
							}
							if (
								Option.isNone(key.childrenName) ||
								key.childrenName.value !== contract.childrenName
							)
								paths.push([...path, "childrenName"]);
							if (key.config.supportKnob && !contract.supportsKnob)
								paths.push([...path, "config", "supportKnob"]);
							if (
								!contract.supportsAlternateVisuals &&
								(Option.isSome(key.config.alterTitle) ||
									Option.isSome(key.config.alterIcon))
							)
								paths.push([...path, "config", "alterTitle"]);
							paths.push(
								...contract
									.validateConfig(key.config)
									.map((field) => [...path, "config", ...field]),
							);
						});
					});
					return paths;
				},
				catch: (cause) => ProfileValidationFailed.fromCause(cause),
			}).pipe(
				Effect.flatMap((paths) =>
					paths.length === 0
						? Effect.void
						: Effect.fail(ProfileValidationFailed.fromCause(undefined, paths)),
				),
			),
	);
	return {
		validateProfile,
		/** Editing retains the original data; dispatch only receives validated keys. */
		dispatchSnapshot: Effect.fn("ProfileFunctionContracts.dispatchSnapshot")(
			function* (
				envelope: ProfileEnvelope,
			): Effect.fn.Return<ProfileEnvelope, ProfileValidationFailed> {
				const profiles = yield* Effect.forEach(envelope.profiles, (profile) =>
					Effect.forEach(profile.pages, (page) =>
						Effect.forEach(page.keys, (key) => {
							if (
								key.config.type === "" ||
								!key.config.display ||
								isUnsupportedProfileKey(key)
							)
								return Effect.succeed(Option.none<ProfileKey>());
							return validateProfile({
								...profile,
								pages: [{ ...page, keys: [key] }],
							}).pipe(
								Effect.as(Option.some(key)),
								Effect.catchTag("ProfileValidationFailed", () =>
									Effect.succeed(Option.none<ProfileKey>()),
								),
							);
						}).pipe(
							Effect.map((keys) => ({
								...page,
								keys: EffectArray.getSomes(keys),
							})),
						),
					).pipe(Effect.map((pages) => ({ ...profile, pages }))),
				);
				return yield* committedProfileSnapshot({ ...envelope, profiles }).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(profileParseFailure(cause)),
					),
				);
			},
		),
	};
};

export class ProfileFunctionContracts extends Effect.Service<ProfileFunctionContracts>()(
	"@open-quake/device/ProfileFunctionContracts",
	{
		accessors: true,
		sync: () => makeValidation(new Map()),
	},
) {}

export const profileFunctionContractsLayer = (
	contracts: ReadonlyMap<string, ProfileFunctionContract>,
): Layer.Layer<ProfileFunctionContracts> =>
	Layer.succeed(
		ProfileFunctionContracts,
		new ProfileFunctionContracts(makeValidation(new Map(contracts))),
	);

import { Effect, Layer, Option } from "effect";
import type { Profile, ProfileKey } from "./profile-contracts.js";
import { ProfileValidationFailed } from "./profile-errors.js";

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
) => ({
	validateProfile: Effect.fn("ProfileFunctionContracts.validateProfile")(
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
	),
});

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
		new ProfileFunctionContracts(makeValidation(contracts)),
	);

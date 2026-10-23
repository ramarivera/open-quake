import { Effect, type ParseResult, Schema } from "effect";
import { ProfileEnvelope } from "./profile-contracts.js";

const freezeTree = (value: unknown): void => {
	if (typeof value !== "object" || value === null) return;
	for (const child of Object.values(value)) freezeTree(child);
	Object.freeze(value);
};

/** Detach caller-owned trees before IO and freeze the fully decoded result. */
export const committedProfileSnapshot = Effect.fn("ProfileRepository.snapshot")(
	(
		envelope: ProfileEnvelope,
	): Effect.Effect<ProfileEnvelope, ParseResult.ParseError> =>
		Schema.decode(Schema.typeSchema(ProfileEnvelope))(envelope).pipe(
			Effect.map((snapshot) => {
				freezeTree(snapshot);
				return snapshot;
			}),
		),
);

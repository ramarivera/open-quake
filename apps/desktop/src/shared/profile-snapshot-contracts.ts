import { Schema } from "effect";
import { ProfileEnvelope } from "./profiles";

export const PROFILES_READ = "profiles:read";
export const PROFILES_SNAPSHOT = "profiles:snapshot";

/**
 * Read-only committed profiles for both windows. Failures carry only the
 * catalog identity (open-quake-errors); diagnostic causes stay in main.
 */
export const ProfileSnapshotReply = Schema.Union(
	Schema.TaggedStruct("ready", { envelope: ProfileEnvelope }),
	Schema.TaggedStruct("failure", {
		code: Schema.Literal(
			"QUAKE.PROFILE.READ_FAILED",
			"QUAKE.PROFILE.WRITE_FAILED",
			"QUAKE.PROFILE.VALIDATION_FAILED",
			"QUAKE.PROFILE.NOT_FOUND",
			"QUAKE.PROFILE.REVISION_CONFLICT",
		),
		message: Schema.String,
	}),
);
export type ProfileSnapshotReply = typeof ProfileSnapshotReply.Type;
export const encodeProfileSnapshotReply =
	Schema.encodeSync(ProfileSnapshotReply);

export interface ProfilesBridge {
	read(): Promise<unknown>;
	onSnapshot(callback: (reply: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeProfiles?: ProfilesBridge;
	}
}

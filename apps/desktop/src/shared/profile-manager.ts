import { Schema } from "effect";
import {
	type Profile,
	ProfileEnvelope,
} from "../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ManagerCommand,
	ProfileLocale,
} from "../../../../packages/device/src/profiles/profile-manager-contracts.js";
export const PROFILE_REQUEST = "profiles:request";
export const PROFILE_SNAPSHOT = "profiles:snapshot";
export const PROFILE_SELECTION = "profiles:selection";
export const PROFILE_PROGRESS = "profiles:thumbnail-progress";
export const ProfileRequest = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("read"),
		locale: ProfileLocale,
		preview: Schema.optional(Schema.Boolean),
	}),
	Schema.Struct({
		type: Schema.Literal("manage"),
		command: Schema.encodedSchema(ManagerCommand),
	}),
	Schema.Struct({
		type: Schema.Literal("thumbnail"),
		id: Schema.String,
		locale: ProfileLocale,
	}),
	Schema.Struct({ type: Schema.Literal("thumbnails", "cancel-thumbnails") }),
	Schema.Struct({
		type: Schema.Literal("run-command"),
		id: Schema.String,
		keyCode: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("choose-app"),
		id: Schema.String,
		device: Schema.optional(Schema.String),
	}),
);
export type ProfileRequest = typeof ProfileRequest.Type;
export interface ThumbnailProgress {
	readonly running: boolean;
	readonly done: number;
	readonly total: number;
	readonly failed: number;
}
export interface ProfileView {
	readonly envelope: typeof ProfileEnvelope.Encoded;
	readonly serials: readonly string[];
	readonly apps: readonly {
		readonly name: string;
		readonly path: string;
		readonly identifier: string;
	}[];
	readonly thumbnails: Readonly<Record<string, string>>;
	readonly progress: ThumbnailProgress;
}
export type ProfileReply =
	| { readonly _tag: "success"; readonly view: ProfileView }
	| { readonly _tag: "rejected"; readonly reason: string };
export interface ProfileDelivery {
	readonly serial: string;
	readonly profile: typeof Profile.Encoded;
	readonly hardware: "unverified";
}
export interface ProfileBridge {
	request: (request: ProfileRequest) => Promise<ProfileReply>;
	onSnapshot: (callback: (view: ProfileView) => void) => () => void;
	onSelection: (callback: (selection: ProfileDelivery) => void) => () => void;
	onProgress: (callback: (progress: ThumbnailProgress) => void) => () => void;
}
declare global {
	interface Window {
		quakeProfiles: ProfileBridge;
	}
}

export const ProfileReplySchema = Schema.Union(
	Schema.Struct({ _tag: Schema.Literal("rejected"), reason: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("success"),
		view: Schema.Struct({
			envelope: Schema.encodedSchema(ProfileEnvelope),
			serials: Schema.Array(Schema.String),
			apps: Schema.Array(
				Schema.Struct({
					name: Schema.String,
					path: Schema.String,
					identifier: Schema.String,
				}),
			),
			thumbnails: Schema.Record({ key: Schema.String, value: Schema.String }),
			progress: Schema.Struct({
				running: Schema.Boolean,
				done: Schema.Number,
				total: Schema.Number,
				failed: Schema.Number,
			}),
		}),
	}),
);

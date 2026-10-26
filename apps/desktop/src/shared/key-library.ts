import { Schema } from "effect";
import { KnobResource } from "../../../../packages/device/src/knob/knob-contracts.js";
import {
	ProfileEnvelope,
	ProfileKey,
} from "../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileImportReport } from "../../../../packages/device/src/profiles/profile-import.js";
import { ProfileLocale } from "../../../../packages/device/src/profiles/profile-manager-contracts.js";

export const KEY_REQUEST = "keys:request",
	KEY_PREVIEW = "keys:preview",
	KEY_RUNTIME = "keys:runtime";
export const KeyTarget = Schema.Struct({
	token: Schema.String.pipe(Schema.minLength(1)),
	profileId: Schema.String,
	pageId: Schema.String,
	keyCode: Schema.String,
	revision: Schema.Int.pipe(Schema.nonNegative()),
});
export const KeyRequest = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("save-knob"),
		profileId: Schema.NonEmptyString,
		revision: Schema.Int.pipe(Schema.nonNegative()),
		knob: KnobResource,
	}),
	Schema.Struct({
		type: Schema.Literal("add-page", "delete-page"),
		profileId: Schema.NonEmptyString,
		pageId: Schema.NonEmptyString,
		revision: Schema.Int.pipe(Schema.nonNegative()),
		deviceId: Schema.NonEmptyString.pipe(
			Schema.filter((id) => id !== "__proto__"),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("inspect-import", "import-profile"),
		source: Schema.String.pipe(Schema.maxLength(8 * 1024 * 1024)),
	}),
	Schema.Struct({
		type: Schema.Literal("select"),
		deviceId: Schema.String,
		profileId: Schema.String,
		pageId: Schema.String,
	}),
	Schema.Struct({ type: Schema.Literal("read"), locale: ProfileLocale }),
	Schema.Struct({
		type: Schema.Literal("preview"),
		target: KeyTarget,
		key: Schema.encodedSchema(ProfileKey),
		geometry: Schema.optional(
			Schema.Struct({
				destination: Schema.optional(Schema.String),
				replaceOverlaps: Schema.optional(Schema.Boolean),
			}),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("save", "revert"),
		token: Schema.String,
	}),
	Schema.Struct({ type: Schema.Literal("delete"), target: KeyTarget }),
	Schema.Struct({
		type: Schema.Literal(
			"icons",
			"application-icons",
			"import-pack",
			"import-icon",
		),
	}),
	Schema.Struct({
		type: Schema.Literal("open-icons"),
		token: Schema.NonEmptyString,
		locale: ProfileLocale,
	}),
	Schema.Struct({
		type: Schema.Literal("cancel-icons"),
		token: Schema.NonEmptyString,
	}),
	Schema.Struct({
		type: Schema.Literal("pick-icon"),
		token: Schema.NonEmptyString,
		data: Schema.String.pipe(Schema.maxLength(8 * 1024 * 1024)),
		source: Schema.optional(
			Schema.String.pipe(Schema.maxLength(8 * 1024 * 1024)),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("remove-pack", "remove-icon"),
		id: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("activate"),
		deviceId: Schema.String,
		keyCode: Schema.String,
		kind: Schema.Literal("press", "release"),
		profileId: Schema.String,
		pageId: Schema.String,
		revision: Schema.Int.pipe(Schema.nonNegative()),
	}),
	Schema.Struct({
		type: Schema.Literal("navigate"),
		deviceId: Schema.String,
		direction: Schema.Literal(0, 1, 2, 3),
	}),
);
export type KeyRequest = typeof KeyRequest.Type;
export const LibraryIcon = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	tags: Schema.Array(Schema.String),
	extraData: Schema.optional(Schema.Array(Schema.String)),
	data: Schema.String,
});
export const LibraryPack = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	icons: Schema.Array(LibraryIcon),
});
export type LibraryPack = typeof LibraryPack.Type;
export const KeyRuntimeState = Schema.Struct({
	deviceId: Schema.String,
	profileId: Schema.String,
	pageId: Schema.String,
	keyCode: Schema.String,
	alternate: Schema.optional(Schema.Literal(0, 1)),
	countdown: Schema.optional(Schema.Number),
	progress: Schema.optional(Schema.Number),
	alert: Schema.optional(Schema.Literal(0, 1, 2, 3)),
});
export type KeyRuntimeState = typeof KeyRuntimeState.Type;
export const KeyReply = Schema.Union(
	Schema.Struct({
		_tag: Schema.Literal("success"),
		envelope: Schema.optional(Schema.encodedSchema(ProfileEnvelope)),
		importReport: Schema.optional(ProfileImportReport),
		importedProfileId: Schema.optional(Schema.String),
		packs: Schema.optional(Schema.Array(LibraryPack)),
		states: Schema.optional(Schema.Array(KeyRuntimeState)),
		icon: Schema.optional(Schema.String),
		iconSource: Schema.optional(Schema.String),
		notice: Schema.optional(Schema.Literal("duplicate-icon")),
	}),
	Schema.Struct({
		_tag: Schema.Literal("rejected"),
		reason: Schema.String,
		keyCodes: Schema.optional(Schema.Array(Schema.String)),
	}),
);
export type KeyReply = typeof KeyReply.Type;
export const KeyPreview = Schema.Struct({
	envelope: Schema.encodedSchema(ProfileEnvelope),
});
export type KeyPreview = typeof KeyPreview.Type;
export interface KeyLibraryBridge {
	request: (request: KeyRequest) => Promise<KeyReply>;
	onPreview: (callback: (preview: KeyPreview) => void) => () => void;
	onRuntime: (callback: (state: KeyRuntimeState) => void) => () => void;
}
declare global {
	interface Window {
		quakeKeyLibrary: KeyLibraryBridge;
	}
}

import { Schema } from "effect";
export const EmojiMode = Schema.Literal(0, 1, 2);
export type EmojiMode = typeof EmojiMode.Type;
export const EmojiCaption = Schema.Struct({
	text: Schema.String,
	size: Schema.Int.pipe(Schema.between(12, 100)),
	color: Schema.String.pipe(Schema.pattern(/^0x[0-9a-f]{8}$/i)),
	position: Schema.Literal("top", "mid", "bot"),
});
export type EmojiCaption = typeof EmojiCaption.Type;
export const defaultCaption: EmojiCaption = {
	text: "",
	size: 48,
	color: "0xffffffff",
	position: "bot",
};
export const EmojiItem = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	mode: Schema.optional(EmojiMode),
	original: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	rendered: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	caption: EmojiCaption,
});
export type EmojiItem = typeof EmojiItem.Type;
export const EmojiPackage = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	emojiIds: Schema.Array(Schema.String).pipe(Schema.maxItems(16)),
	profileId: Schema.NullOr(Schema.String),
});
export type EmojiPackage = typeof EmojiPackage.Type;
export const EmojiApp = Schema.Struct({
	name: Schema.String,
	path: Schema.String,
	identifier: Schema.String,
});
export type EmojiApp = typeof EmojiApp.Type;
export const EmojiStaticAsset = Schema.Struct({
	hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	name: Schema.String,
	format: Schema.Literal("image/png", "image/jpeg"),
});
export const EmojiStore = Schema.Struct({
	version: Schema.Literal(1),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	staticAssets: Schema.Array(EmojiStaticAsset),
	packages: Schema.Array(EmojiPackage),
	items: Schema.Array(EmojiItem),
	drafts: Schema.Array(Schema.String),
	appMatch: Schema.Boolean,
	apps: Schema.Array(EmojiApp),
	globalMode: Schema.NullOr(EmojiMode),
});
export type EmojiStore = typeof EmojiStore.Type;
export const emptyEmojiStore: EmojiStore = {
	version: 1,
	revision: 0,
	staticAssets: [],
	packages: [],
	items: [],
	drafts: [],
	appMatch: true,
	apps: [],
	globalMode: 1,
};
export const EmojiCommand = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("delete-static"),
		hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	}),
	Schema.Struct({
		type: Schema.Literal("create-package"),
		id: Schema.String,
		name: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("rename-package"),
		id: Schema.String,
		name: Schema.String,
	}),
	Schema.Struct({ type: Schema.Literal("delete-package"), id: Schema.String }),
	Schema.Struct({
		type: Schema.Literal("add-drafts"),
		packageId: Schema.String,
		ids: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		type: Schema.Literal("remove-emoji"),
		packageId: Schema.String,
		id: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("settings"),
		appMatch: Schema.Boolean,
		apps: Schema.Array(EmojiApp),
		globalMode: Schema.NullOr(EmojiMode),
	}),
);
export type EmojiCommand = typeof EmojiCommand.Type;
export const EmojiKeyReference = Schema.Struct({
	packageId: Schema.String,
	emojiId: Schema.String,
	hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
});
export type EmojiKeyReference = typeof EmojiKeyReference.Type;

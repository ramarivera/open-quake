import { Schema } from "effect";
import {
	EmojiApp,
	EmojiCaption,
	EmojiCommand,
	type EmojiMode,
	EmojiStore,
} from "../../../../packages/edge/src/emoji/emoji-contracts";
export const EMOJI_REQUEST = "emoji:request";
export const EMOJI_PRESS = "emoji:press";
export const EmojiRequest = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("suggest-caption"),
		prompt: Schema.String,
		locale: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal(
			"read",
			"cancel-generation",
			"import-static",
			"import-gif",
			"installed-apps",
			"pick-app",
		),
	}),
	Schema.Struct({ type: Schema.Literal("command"), command: EmojiCommand }),
	Schema.Struct({
		type: Schema.Literal("create-result"),
		name: Schema.String,
		base64: Schema.String,
		renderedBase64: Schema.optional(Schema.String),
		caption: Schema.optional(EmojiCaption),
	}),
	Schema.Struct({
		type: Schema.Literal("caption"),
		name: Schema.optional(Schema.String),
		mode: Schema.optional(Schema.Literal(0, 1, 2)),
		id: Schema.String,
		caption: EmojiCaption,
		base64: Schema.String,
	}),
	Schema.Struct({ type: Schema.Literal("place", "export"), id: Schema.String }),
	Schema.Struct({
		type: Schema.Literal("asset"),
		hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	}),
	Schema.Struct({
		type: Schema.Literal("generate"),
		assetId: Schema.String,
		prompt: Schema.String,
		name: Schema.optional(Schema.String),
		caption: Schema.optional(EmojiCaption),
	}),
);
export type EmojiRequest = typeof EmojiRequest.Type;
export const EmojiPressRequest = Schema.Struct({
	keyCode: Schema.String,
	profileId: Schema.String,
	pageId: Schema.String,
	keyAction: Schema.Literal(0, 1, 2),
});
export type EmojiPressRequest = typeof EmojiPressRequest.Type;
export const EmojiReply = Schema.Union(
	Schema.Struct({
		_tag: Schema.Literal("caption-suggestion"),
		text: Schema.String,
	}),
	Schema.Struct({
		_tag: Schema.Literal("generated"),
		base64: Schema.String,
		name: Schema.String,
		caption: EmojiCaption,
	}),
	Schema.Struct({
		_tag: Schema.Literal("ready"),
		store: EmojiStore,
		assets: Schema.Record({ key: Schema.String, value: Schema.String }),
		notice: Schema.String,
		apps: Schema.Array(EmojiApp),
	}),
	Schema.Struct({
		_tag: Schema.Literal("failure"),
		code: Schema.String,
		message: Schema.String,
	}),
);
export type EmojiReply = typeof EmojiReply.Type;
export interface EmojiBridge {
	readonly request: (input: EmojiRequest) => Promise<EmojiReply>;
	readonly press: (
		input: EmojiPressRequest,
	) => Promise<{ readonly _tag: "ignored" | "handled" | "invalid" }>;
}
export const decodeEmojiMode = (value: unknown): EmojiMode =>
	value === 0 || value === 2 ? value : 1;
declare global {
	interface Window {
		readonly quakeEmoji?: EmojiBridge;
	}
}

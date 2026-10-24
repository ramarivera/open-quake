import { Schema } from "effect";
export const emojiErrors = {
	library: {
		code: "QUAKE.EMOJI.LIBRARY_FAILED",
		category: "dependency",
		message: "Emoji library could not be saved",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	invalid: {
		code: "QUAKE.EMOJI.INVALID",
		category: "validation",
		message: "Emoji request is invalid",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	clipboard: {
		code: "QUAKE.EMOJI.CLIPBOARD_FAILED",
		category: "dependency",
		message: "The GIF could not be copied",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	keyboard: {
		code: "QUAKE.EMOJI.KEYBOARD_FAILED",
		category: "dependency",
		message: "The device keyboard is unavailable",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	foreground: {
		code: "QUAKE.EMOJI.FOREGROUND_FAILED",
		category: "dependency",
		message: "The foreground application could not be checked",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
} as const;
const keep = (target: object, cause: unknown): void => {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
};
export class EmojiLibraryFailed extends Schema.TaggedError<EmojiLibraryFailed>()(
	"EmojiLibraryFailed",
	{
		code: Schema.Literal(emojiErrors.library.code),
		message: Schema.Literal(emojiErrors.library.message),
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(emojiErrors.library);
		keep(this, cause);
	}
}
export class EmojiInvalid extends Schema.TaggedError<EmojiInvalid>()(
	"EmojiInvalid",
	{
		code: Schema.Literal(emojiErrors.invalid.code),
		message: Schema.Literal(emojiErrors.invalid.message),
		reason: Schema.String,
	},
) {
	constructor(reason: string) {
		super({ ...emojiErrors.invalid, reason });
	}
}
export class EmojiClipboardFailed extends Schema.TaggedError<EmojiClipboardFailed>()(
	"EmojiClipboardFailed",
	{
		code: Schema.Literal(emojiErrors.clipboard.code),
		message: Schema.Literal(emojiErrors.clipboard.message),
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(emojiErrors.clipboard);
		keep(this, cause);
	}
}
export class EmojiKeyboardFailed extends Schema.TaggedError<EmojiKeyboardFailed>()(
	"EmojiKeyboardFailed",
	{
		code: Schema.Literal(emojiErrors.keyboard.code),
		message: Schema.Literal(emojiErrors.keyboard.message),
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(emojiErrors.keyboard);
		keep(this, cause);
	}
}
export class EmojiForegroundFailed extends Schema.TaggedError<EmojiForegroundFailed>()(
	"EmojiForegroundFailed",
	{
		code: Schema.Literal(emojiErrors.foreground.code),
		message: Schema.Literal(emojiErrors.foreground.message),
	},
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(emojiErrors.foreground);
		keep(this, cause);
	}
}

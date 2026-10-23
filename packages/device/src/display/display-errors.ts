import { Schema } from "effect";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual",
} as const;
const entry = <const Code extends string, const Message extends string>(
	code: Code,
	message: Message,
) => ({ code, message, category: "display", policy }) as const;
export const DisplayErrors = {
	InvalidWallpaper: entry(
		"QUAKE.DISPLAY.INVALID_WALLPAPER",
		"Wallpaper settings are invalid",
	),
	MediaUnreadable: entry(
		"QUAKE.DISPLAY.MEDIA_UNREADABLE",
		"Select a readable JPEG or PNG image",
	),
	MediaPersistenceFailed: entry(
		"QUAKE.DISPLAY.MEDIA_PERSISTENCE_FAILED",
		"Wallpaper could not be saved; the previous revision was retained",
	),
	ResourceTargetUnverified: entry(
		"QUAKE.DISPLAY.RESOURCE_TARGET_UNVERIFIED",
		"Device resource target has not been verified",
	),
} as const;
const fields = <const Code extends string, const Message extends string>(def: {
	code: Code;
	message: Message;
	category: "display";
}) => ({
	code: Schema.Literal(def.code),
	message: Schema.Literal(def.message),
	category: Schema.Literal(def.category),
	diagnosticCause: Schema.Struct({ name: Schema.Literal("DisplayBoundary") }),
});
const props = <const Code extends string, const Message extends string>(def: {
	code: Code;
	message: Message;
	category: "display";
}) => ({
	code: def.code,
	message: def.message,
	category: def.category,
	diagnosticCause: { name: "DisplayBoundary" as const },
});
function retain(target: object, cause: unknown): void {
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});
}
export class InvalidWallpaper extends Schema.TaggedError<InvalidWallpaper>()(
	"InvalidWallpaper",
	fields(DisplayErrors.InvalidWallpaper),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DisplayErrors.InvalidWallpaper));
		retain(this, cause);
	}
}
export class MediaUnreadable extends Schema.TaggedError<MediaUnreadable>()(
	"MediaUnreadable",
	fields(DisplayErrors.MediaUnreadable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DisplayErrors.MediaUnreadable));
		retain(this, cause);
	}
}
export class MediaPersistenceFailed extends Schema.TaggedError<MediaPersistenceFailed>()(
	"MediaPersistenceFailed",
	fields(DisplayErrors.MediaPersistenceFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown) {
		super(props(DisplayErrors.MediaPersistenceFailed));
		retain(this, cause);
	}
}
export class ResourceTargetUnverified extends Schema.TaggedError<ResourceTargetUnverified>()(
	"ResourceTargetUnverified",
	fields(DisplayErrors.ResourceTargetUnverified),
) {
	constructor() {
		super(props(DisplayErrors.ResourceTargetUnverified));
	}
}

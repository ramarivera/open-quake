import { GIF_LIMITS } from "./types";

const validation = Object.freeze({
	userFacing: true,
	userRecoverable: true,
	retry: "never",
});

const entry = <const Code extends string>(code: Code, message: string) =>
	Object.freeze({ code, message });

/** Pure-codec errors deliberately require no Effect/browser/Node runtime. */
export const GifErrors = {
	invalid: entry("QUAKE.GIF.INVALID", "GIF data is invalid"),
	limit: entry("QUAKE.GIF.LIMIT", "GIF exceeds the import limits"),
	unsupported: entry(
		"QUAKE.GIF.UNSUPPORTED",
		"GIF contains an unsupported rendering feature",
	),
	settings: entry("QUAKE.GIF.CAPTION_SETTINGS", "Caption settings are invalid"),
	canvas: entry(
		"QUAKE.GIF.CANVAS_UNAVAILABLE",
		"Image rendering is unavailable",
	),
	image: entry("QUAKE.GIF.IMAGE_INVALID", "Still image is invalid"),
};

export type GifErrorCode = (typeof GifErrors)[keyof typeof GifErrors]["code"];

export class GifError extends Error {
	declare readonly originalCause: unknown;
	readonly name = "GifError";
	readonly category = "validation";
	readonly policy = validation;
	readonly code: GifErrorCode;

	constructor(
		kind: keyof typeof GifErrors,
		originalCause: unknown = undefined,
	) {
		const definition = GifErrors[kind];
		super(definition.message);
		this.code = definition.code;
		Object.defineProperty(this, "originalCause", {
			value: originalCause,
			enumerable: false,
		});
	}
}

export function checkDimensions(width: number, height: number): void {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1
	) {
		throw new GifError("invalid");
	}
	if (width > GIF_LIMITS.maxWidth || height > GIF_LIMITS.maxHeight)
		throw new GifError("limit");
}

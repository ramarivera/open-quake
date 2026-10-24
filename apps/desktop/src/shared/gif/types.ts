/** Full, independently owned, composited canvas frames. Delays are milliseconds. */
export interface GifFrame {
	readonly rgba: Uint8ClampedArray;
	readonly delayMs: number;
}

export interface GifAnimation {
	readonly width: number;
	readonly height: number;
	readonly frames: readonly GifFrame[];
	/** Raw Netscape repeat count: null = no extension, 0 = forever. */
	readonly loopCount: number | null;
}

export const GIF_LIMITS = Object.freeze({
	maxBytes: 8 * 1024 * 1024,
	maxWidth: 1024,
	maxHeight: 1024,
	maxFrames: 300,
	/** Retained RGBA frames, excluding the bounded working canvas/dictionary. */
	maxDecodedBytes: 128 * 1024 * 1024,
});

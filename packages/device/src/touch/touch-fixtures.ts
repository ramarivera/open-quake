/** Synthetic source-derived vectors, not hardware recordings. Bytes 1/2 are opaque. */
export const SYNTHETIC_TOUCH_DOWN = Uint8Array.from([
	0xa3, 0, 0, 0x1a, 1, 1, 104, 1, 120, 0,
]);
export const SYNTHETIC_TOUCH_MOVE = Uint8Array.from([
	0xa3, 0, 0, 0x1a, 1, 1, 104, 1, 128, 0,
]);
export const SYNTHETIC_TOUCH_EMPTY = Uint8Array.from([0xa3, 0, 0, 0x1a, 0]);

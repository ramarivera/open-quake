/** Equal-size 4-byte-per-pixel bitmaps; channel order only needs to match. */
export interface PanelBitmap {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

export interface PanelPixelEvidence {
	/** Mean absolute RGB difference between the display and the rendered panel. */
	readonly panelDifference: number;
	/** Mean absolute RGB difference between the display and its pre-launch content. */
	readonly desktopDifference: number;
	/** Largest per-channel standard deviation of the display; near zero is a flat frame. */
	readonly colorDeviation: number;
	/** Share of opaque rendered-panel pixels compared. */
	readonly coverage: number;
	readonly passed: boolean;
}

const OPAQUE = 200;
export const PANEL_MATCH_LIMIT = 16;
export const DESKTOP_CHANGE_MINIMUM = 24;
export const BLANK_DEVIATION_LIMIT = 4;
export const COVERAGE_MINIMUM = 0.9;

/**
 * Decide whether a captured display shows the rendered panel: close to the
 * panel's own pixels, clearly changed from the desktop it replaced and not blank.
 */
export function comparePanelPixels(
	display: PanelBitmap,
	panel: PanelBitmap,
	desktop: PanelBitmap,
): PanelPixelEvidence {
	for (const other of [panel, desktop])
		if (
			other.width !== display.width ||
			other.height !== display.height ||
			other.data.length !== display.data.length
		)
			throw new Error("Panel bitmaps must share one size");
	const pixels = display.width * display.height;
	if (pixels === 0 || display.data.length !== pixels * 4)
		throw new Error("Panel bitmaps must hold four bytes per pixel");
	let compared = 0;
	let panelSum = 0;
	let desktopSum = 0;
	const sums = [0, 0, 0];
	const squares = [0, 0, 0];
	for (let offset = 0; offset < display.data.length; offset += 4) {
		for (let channel = 0; channel < 3; channel++) {
			const value = display.data[offset + channel] ?? 0;
			sums[channel] = (sums[channel] ?? 0) + value;
			squares[channel] = (squares[channel] ?? 0) + value * value;
		}
		desktopSum += channelDifference(display.data, desktop.data, offset);
		if ((panel.data[offset + 3] ?? 0) < OPAQUE) continue;
		compared++;
		panelSum += channelDifference(display.data, panel.data, offset);
	}
	// Per channel, so equal-brightness colors don't read as flat.
	const colorDeviation = Math.max(
		...sums.map((sum, channel) => {
			const mean = sum / pixels;
			return Math.sqrt(
				Math.max(0, (squares[channel] ?? 0) / pixels - mean * mean),
			);
		}),
	);
	const coverage = compared / pixels;
	const panelDifference = compared ? panelSum / compared : 255;
	const desktopDifference = desktopSum / pixels;
	return {
		panelDifference,
		desktopDifference,
		colorDeviation,
		coverage,
		passed:
			coverage >= COVERAGE_MINIMUM &&
			panelDifference <= PANEL_MATCH_LIMIT &&
			desktopDifference >= DESKTOP_CHANGE_MINIMUM &&
			colorDeviation > BLANK_DEVIATION_LIMIT,
	};
}

function channelDifference(
	left: Uint8Array,
	right: Uint8Array,
	offset: number,
): number {
	let sum = 0;
	for (let channel = 0; channel < 3; channel++)
		sum += Math.abs(
			(left[offset + channel] ?? 0) - (right[offset + channel] ?? 0),
		);
	return sum / 3;
}

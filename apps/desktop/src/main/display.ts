import type { Display, Rectangle } from "electron";

export const PANEL_SIZE = { width: 1920, height: 480 } as const;
const PANEL_LABEL = "DK-QUAKE";

/** Degrees the renderer rotates its logical 1920x480 canvas by. */
export type PanelRotation = 0 | 90;

export const physicalSize = (display: Display): Display["size"] => ({
	width: Math.round(display.size.width * display.scaleFactor),
	height: Math.round(display.size.height * display.scaleFactor),
});

export const isPanelShaped = (display: Display): boolean => {
	const { width, height } = physicalSize(display);
	return [
		[1920, 480],
		[480, 1920],
	].some(
		([w = 0, h = 0]) => Math.abs(width - w) < 10 && Math.abs(height - h) < 10,
	);
};
export const isPanelCandidate = (display: Display): boolean =>
	isPanelShaped(display) || display.label.toUpperCase().includes(PANEL_LABEL);

/**
 * Pick a unique physical-size candidate, then a unique DK-QUAKE label.
 * Multiple size matches require screen-off pairing. macOS reports the strip's
 * native framebuffer as 480x1920 unless the user rotated it in System Settings.
 */
export function findPanelDisplay(
	displays: readonly Display[],
): Display | undefined {
	const sized = displays.filter(isPanelShaped);
	if (sized.length === 1) return sized[0];
	if (sized.length > 1) return undefined;
	const labelled = displays.filter(isPanelCandidate);
	return labelled.length === 1 ? labelled[0] : undefined;
}

/**
 * The strip's portrait framebuffer shows the landscape canvas rotated, like
 * DK-Suite. A fallback window is always landscape, so it never rotates.
 */
export function panelRotation(
	display: Display,
	isPanel: boolean,
): PanelRotation {
	return isPanel && display.size.height > display.size.width ? 90 : 0;
}

/**
 * The panel owns the whole QUAKE display, menu-bar area included. Without
 * hardware it is a 1920x480 window inside the fallback display's work area.
 */
export function panelBounds(display: Display, isPanel: boolean): Rectangle {
	if (isPanel) return { ...display.bounds };
	return {
		x: display.workArea.x,
		y: display.workArea.y,
		width: Math.min(PANEL_SIZE.width, display.workArea.width),
		height: Math.min(PANEL_SIZE.height, display.workArea.height),
	};
}

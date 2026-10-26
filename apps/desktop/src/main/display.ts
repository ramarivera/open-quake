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

/** Project physical sizes through adjacent DIP origins, as the native display diagnostic does. */
export function physicalLayout(displays: readonly Display[]) {
	const origin =
		displays.find((d) => d.bounds.x === 0 && d.bounds.y === 0) ?? displays[0];
	return displays
		.map((display) => {
			let x = display.bounds.x;
			let y = display.bounds.y;
			for (const other of displays) {
				if (other.id === display.id) continue;
				const dx = other.bounds.width * (other.scaleFactor - 1);
				const dy = other.bounds.height * (other.scaleFactor - 1);
				if (
					origin &&
					display.bounds.x >= origin.bounds.x &&
					other.bounds.x >= origin.bounds.x &&
					display.bounds.x >= other.bounds.x + other.bounds.width
				)
					x += dx;
				if (
					origin &&
					display.bounds.x + display.bounds.width <= origin.bounds.x &&
					other.bounds.x + other.bounds.width <= origin.bounds.x &&
					display.bounds.x + display.bounds.width <= other.bounds.x
				)
					x -= dx;
				if (
					origin &&
					display.bounds.y >= origin.bounds.y &&
					other.bounds.y >= origin.bounds.y &&
					display.bounds.y >= other.bounds.y + other.bounds.height
				)
					y += dy;
				if (
					origin &&
					display.bounds.y + display.bounds.height <= origin.bounds.y &&
					other.bounds.y + other.bounds.height <= origin.bounds.y &&
					display.bounds.y + display.bounds.height <= other.bounds.y
				)
					y -= dy;
			}
			return {
				id: display.id,
				x: Math.round(x),
				y: Math.round(y),
				width: Math.round(display.bounds.width * display.scaleFactor),
				height: Math.round(display.bounds.height * display.scaleFactor),
				strip: isPanelCandidate(display),
			};
		})
		.sort((a, b) => a.x - b.x || a.y - b.y || a.id - b.id)
		.map((display, order) => ({ ...display, order }));
}

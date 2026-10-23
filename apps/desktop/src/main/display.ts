import type { Display, Rectangle } from "electron";

export const PANEL_SIZE = { width: 1920, height: 480 } as const;
const PANEL_LABEL = "DK-QUAKE";

/** Degrees the renderer rotates its logical 1920x480 canvas by. */
export type PanelRotation = 0 | 90;

const isPanelShaped = ({ width, height }: Display["size"]): boolean =>
	(width === PANEL_SIZE.width && height === PANEL_SIZE.height) ||
	(width === PANEL_SIZE.height && height === PANEL_SIZE.width);

/**
 * Find the display the QUAKE panel should own: prefer the one advertising the
 * DK-QUAKE label, else a 1920x480-shaped display in either orientation, else
 * undefined (no hardware). macOS reports the strip's native framebuffer as
 * 480x1920 unless the user rotated it in System Settings.
 */
export function findPanelDisplay(
	displays: readonly Display[],
): Display | undefined {
	return (
		displays.find((d) => (d.label ?? "").toUpperCase().includes(PANEL_LABEL)) ??
		displays.find((d) => isPanelShaped(d.size))
	);
}

/** A portrait framebuffer shows the landscape canvas rotated, like DK-Suite. */
export function panelRotation(display: Display): PanelRotation {
	return display.size.height > display.size.width ? 90 : 0;
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

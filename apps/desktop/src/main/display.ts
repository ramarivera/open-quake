import type { Display } from "electron"

export const PANEL_SIZE = { width: 1920, height: 480 } as const
const PANEL_LABEL = "DK-QUAKE"

/**
 * Find the display the QUAKE panel should own: prefer the one advertising the
 * DK-QUAKE label, else a 1920x480-shaped display, else null (no hardware).
 */
export function findPanelDisplay(
	displays: readonly Display[],
): Display | undefined {
	return (
		displays.find((d) =>
			(d.label ?? "").toUpperCase().includes(PANEL_LABEL),
		) ??
		displays.find(
			(d) =>
				d.size.width === PANEL_SIZE.width && d.size.height === PANEL_SIZE.height,
		)
	)
}

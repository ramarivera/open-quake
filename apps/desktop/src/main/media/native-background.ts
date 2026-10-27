import type { BrowserWindow } from "electron";

/** Transparent capability is fixed at panel creation; only its color changes. */
export function applyWallpaperBackground(
	window: Pick<
		BrowserWindow,
		| "isDestroyed"
		| "getBounds"
		| "setBackgroundColor"
		| "setBounds"
		| "isAlwaysOnTop"
		| "setAlwaysOnTop"
	>,
	transparent: boolean,
): void {
	if (window.isDestroyed()) return;
	const bounds = window.getBounds();
	window.setBackgroundColor(transparent ? "#00000000" : "#000000");
	window.setBounds(bounds);
	if (window.isAlwaysOnTop()) window.setAlwaysOnTop(true, "screen-saver");
}

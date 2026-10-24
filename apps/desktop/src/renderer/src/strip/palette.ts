/**
 * DK-Suite's fixed strip palette (QuakeScreenView, QuakeShortCutView, App.vue).
 * The strip is a dark hardware display, so these do not follow the app theme
 * (ui-theming "Shared theme tokens" exception). StripScreen publishes them as
 * `--strip-*` custom properties for strip.css.
 */
export const STRIP_PALETTE = {
	canvas: "#000000",
	slot: "rgba(255, 255, 255, 0.04)",
	emptyBorder: "rgba(107, 120, 145, 0.8)",
	emptyHoverBorder: "rgba(233, 235, 239, 0.4)",
	pressGlow: "rgba(255, 255, 255, 0.4)",
	title: "#FFFFFF",
	font: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
} as const;

export const stripPaletteProperties = (): Record<string, string> =>
	Object.fromEntries(
		Object.entries(STRIP_PALETTE).map(([name, value]) => [
			`--strip-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
			value,
		]),
	);

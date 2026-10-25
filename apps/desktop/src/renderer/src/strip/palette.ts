/**
 * The device strip palette (openspec/changes/independent-device-design,
 * "Device palette and type"). The strip is a lit hardware display, so these do
 * not follow the app theme. StripScreen publishes them as `--strip-*` custom
 * properties for every strip stylesheet.
 */
export const STRIP_PALETTE = {
	canvas: "#000000",
	scrim: "rgba(11, 12, 13, 0.92)",
	surface: "#15171a",
	raised: "#1e2124",
	hairline: "#26292d",
	line: "#3a3e43",
	text: "#f2f1ee",
	muted: "#a3a29d",
	subtle: "#74746f",
	accent: "#5fcab5",
	accentInk: "#062520",
	accentSoft: "rgba(95, 202, 181, 0.16)",
	success: "#62c98a",
	warning: "#e7b153",
	warningSoft: "rgba(231, 177, 83, 0.14)",
	danger: "#f08a78",
	dangerSoft: "rgba(240, 138, 120, 0.14)",
	/** Agent identity rings in a multi-agent chat; identity, not state. */
	agentBlue: "#7fb2f0",
	agentViolet: "#b9a2f2",
	font: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
} as const;

export const stripPaletteProperties = (): Record<string, string> =>
	Object.fromEntries(
		Object.entries(STRIP_PALETTE).map(([name, value]) => [
			`--strip-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
			value,
		]),
	);

/** Theme corner radii (48 / 24 / 0 on 220-ish cells) drawn at the device radius. */
export const deviceRadius = (radius: number): number =>
	Math.round((radius * 7) / 12);

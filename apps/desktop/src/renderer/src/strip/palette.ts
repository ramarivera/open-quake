/**
 * The device strip palette (openspec/changes/independent-device-design,
 * "Device palette and type"). The strip is a lit hardware display, so these do
 * not follow the app theme. StripScreen publishes them as `--strip-*` custom
 * properties for every strip stylesheet.
 */
export const STRIP_PALETTE = {
	canvas: "#0b0c0d",
	scrim: "rgba(11, 12, 13, 0.92)",
	surface: "#121416",
	raised: "#202326",
	hairline: "#26292d",
	line: "#3a3e43",
	text: "#f2f1ee",
	muted: "#a3a29d",
	subtle: "#74746f",
	accent: "#f2a93b",
	accentInk: "#271b09",
	accentSoft: "rgba(242, 169, 59, 0.16)",
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

/** Console banks use small corners; explicit square themes stay square. */
export const deviceRadius = (radius: number): number => (radius > 0 ? 4 : 0);

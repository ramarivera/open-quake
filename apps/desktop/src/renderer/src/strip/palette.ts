/** Signal Deck fallback colors. Published properties inherit the shared appearance palette. */
export const STRIP_PALETTE = {
	canvas: "#080d1a",
	scrim: "rgba(8, 13, 26, 0.92)",
	surface: "#101830",
	raised: "#192442",
	hairline: "#263452",
	line: "#526280",
	text: "#f2f5ff",
	muted: "#a3aecc",
	subtle: "#8b9ab8",
	accent: "#c3ee3a",
	selection: "#69bcff",
	accentInk: "#172000",
	accentSoft: "rgba(195, 238, 58, 0.16)",
	success: "#9cdb78",
	warning: "#f2b640",
	warningSoft: "rgba(231, 177, 83, 0.14)",
	danger: "#ff929b",
	dangerSoft: "rgba(240, 138, 120, 0.14)",
	/** Agent identity rings in a multi-agent chat; identity, not state. */
	agentBlue: "#7fb2f0",
	agentViolet: "#b9a2f2",
	font: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
} as const;

/** CSS variable aliases preserve standalone preview fallbacks and follow the app theme. */
export const stripPaletteProperties = (): Record<string, string> => {
	const aliases: Readonly<Record<string, string>> = {
		canvas: "var(--quake-background, #080d1a)",
		surface: "var(--quake-surface, #101830)",
		raised:
			"color-mix(in srgb, var(--quake-surface, #101830) 88%, var(--quake-foreground, #f2f5ff))",
		text: "var(--quake-foreground, #f2f5ff)",
		muted: "var(--quake-muted, #a3aecc)",
		subtle: "var(--quake-muted, #a3aecc)",
		line: "var(--quake-border, #6c7da2)",
		hairline:
			"color-mix(in srgb, var(--quake-foreground, #f2f5ff) 18%, var(--quake-surface, #101830))",
		accent: "var(--quake-accent, #c3ee3a)",
		accentInk: "var(--quake-accent-text, #172000)",
		selection: "var(--quake-selection, #69bcff)",
		accentSoft:
			"color-mix(in srgb, var(--quake-accent, #c3ee3a) 14%, transparent)",
		success: "var(--quake-success, #9cdb78)",
		warning: "var(--quake-warning, #f2b640)",
		danger: "var(--quake-danger, #ff929b)",
		warningSoft:
			"color-mix(in srgb, var(--quake-warning, #f2b640) 14%, transparent)",
		dangerSoft:
			"color-mix(in srgb, var(--quake-danger, #ff929b) 14%, transparent)",
		scrim:
			"color-mix(in srgb, var(--quake-background, #080d1a) 94%, transparent)",
	};
	return Object.fromEntries(
		Object.entries(STRIP_PALETTE).map(([name, value]) => [
			`--strip-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
			aliases[name] ?? value,
		]),
	);
};

/** Console banks use small corners; explicit square themes stay square. */
export const deviceRadius = (radius: number): number => (radius > 0 ? 4 : 0);

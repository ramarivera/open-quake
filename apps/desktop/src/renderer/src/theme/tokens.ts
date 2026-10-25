/**
 * The semantic color contract. Each token becomes a `--quake-<token>` custom
 * property and is the only thing a custom theme may override. Surfaces,
 * hairlines and tints are derived from these in styles.css, so an imported
 * palette stays coherent without naming every shade.
 */
export const themeTokenNames = [
	"background",
	"surface",
	"foreground",
	"muted",
	"border",
	"accent",
	"accent-text",
	"success",
	"warning",
] as const;

export type ThemeToken = (typeof themeTokenNames)[number];
export type ThemeTokens = Readonly<Record<ThemeToken, string>>;
export type BuiltinTheme = "dark" | "light" | "grey";

/**
 * open-quake's own palettes (nyd.2, superseding the recovered DK-Suite values).
 * Neutral surfaces with one jade accent for primary action, selection and
 * focus; green/amber stay state colours. Ids are stable stored values; the
 * user-facing names live in themeLabels.
 */
export const themes = {
	dark: {
		background: "#0f1011",
		surface: "#17181a",
		foreground: "#f0efec",
		muted: "#9f9e99",
		border: "#67686b",
		accent: "#5fcab5",
		"accent-text": "#062520",
		success: "#62c98a",
		warning: "#e7b153",
	},
	grey: {
		background: "#1c1d1f",
		surface: "#242528",
		foreground: "#ecebe8",
		muted: "#a6a5a0",
		border: "#727274",
		accent: "#5fcab5",
		"accent-text": "#062520",
		success: "#62c98a",
		warning: "#e7b153",
	},
	light: {
		background: "#f5f4f1",
		surface: "#ffffff",
		foreground: "#1c1b19",
		muted: "#5d5c57",
		border: "#8c8b85",
		accent: "#0b7466",
		"accent-text": "#ffffff",
		success: "#1d7a3e",
		warning: "#8a5a00",
	},
} as const satisfies Record<BuiltinTheme, ThemeTokens>;

export const themeLabels: Readonly<Record<BuiltinTheme, string>> = {
	grey: "Graphite",
	dark: "Midnight",
	light: "Paper",
};

/** Display order for theme pickers: default first, then dark to light. */
export const builtinThemeOrder: ReadonlyArray<BuiltinTheme> = [
	"grey",
	"dark",
	"light",
];

export function toThemeProperties(
	tokens: ThemeTokens,
): Readonly<Record<`--quake-${ThemeToken}`, string>> {
	return {
		"--quake-background": tokens.background,
		"--quake-surface": tokens.surface,
		"--quake-foreground": tokens.foreground,
		"--quake-muted": tokens.muted,
		"--quake-border": tokens.border,
		"--quake-accent": tokens.accent,
		"--quake-accent-text": tokens["accent-text"],
		"--quake-success": tokens.success,
		"--quake-warning": tokens.warning,
	};
}

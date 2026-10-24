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
export type BuiltinTheme = "dark" | "light";

// Graphite neutrals with one warm signal color. `border` is reserved for
// control boundaries, so it keeps 3:1 against both background and surface.
export const themes = {
	dark: {
		background: "#18181b",
		surface: "#232327",
		foreground: "#f4f4f5",
		muted: "#a8a8b0",
		border: "#75757e",
		accent: "#ff9a4d",
		"accent-text": "#1f1206",
		success: "#5ad68a",
		warning: "#f5c451",
	},
	light: {
		background: "#f4f4f6",
		surface: "#ffffff",
		foreground: "#1d1d21",
		muted: "#5f5f68",
		border: "#85858e",
		accent: "#b4480b",
		"accent-text": "#ffffff",
		success: "#1c7a3e",
		warning: "#8a5a00",
	},
} as const satisfies Record<BuiltinTheme, ThemeTokens>;

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

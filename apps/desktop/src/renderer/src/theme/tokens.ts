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

// CENTER-004 fallbacks and MGMT-434 installed CSS, read without launching DK-Suite.
export const themes = {
	dark: {
		background: "#0a0a0b",
		surface: "#131316",
		foreground: "#f4f4f5",
		muted: "#a8a8b0",
		border: "#75757e",
		accent: "#ffffff",
		"accent-text": "#0b0b0d",
		success: "#4ade80",
		warning: "#f5b547",
	},
	grey: {
		background: "#282828",
		surface: "#2f2f2f",
		foreground: "#f0f0f0",
		muted: "#a8a8a8",
		border: "#8a8a8a",
		accent: "#5a5a5a",
		"accent-text": "#fafafa",
		success: "#10b981",
		warning: "#f5b547",
	},
	light: {
		background: "#f6f4f0",
		surface: "#ffffff",
		foreground: "#211e1a",
		muted: "#6e6960",
		border: "#858078",
		accent: "#0369a1",
		"accent-text": "#ffffff",
		success: "#18733a",
		warning: "#885500",
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

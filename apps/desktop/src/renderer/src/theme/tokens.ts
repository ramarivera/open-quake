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

export const themes = {
	dark: {
		background: "#0b0e14",
		surface: "#161b24",
		foreground: "#e6edf3",
		muted: "#a5b1c2",
		border: "#62708a",
		accent: "#8cbbff",
		"accent-text": "#0b0e14",
		success: "#70d787",
		warning: "#e8bd58",
	},
	light: {
		background: "#f5f7fa",
		surface: "#ffffff",
		foreground: "#182230",
		muted: "#526174",
		border: "#718096",
		accent: "#174ea6",
		"accent-text": "#ffffff",
		success: "#216e39",
		warning: "#805900",
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

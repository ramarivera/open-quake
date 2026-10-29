import {
	type ThemeToken,
	type ThemeTokens,
	themes,
	themeTokenNames,
} from "./tokens";

export const MAX_THEME_BYTES = 16_384;

export type CustomTheme = {
	readonly version: 1;
	readonly name: string;
	readonly base: "dark" | "light";
	readonly colors: Readonly<Partial<Record<ThemeToken, string>>>;
};

export type ThemeValidation =
	| { readonly status: "valid"; readonly theme: CustomTheme }
	| { readonly status: "invalid"; readonly reason: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCustomTheme(value: unknown): ThemeValidation {
	if (!isRecord(value)) {
		return { status: "invalid", reason: "Theme must be a JSON object." };
	}
	if (
		Object.keys(value).some(
			(key) => !["version", "name", "base", "colors"].includes(key),
		)
	) {
		return { status: "invalid", reason: "Theme contains an unknown field." };
	}
	if (value.version !== 1) {
		return { status: "invalid", reason: "Theme version must be 1." };
	}
	if (
		typeof value.name !== "string" ||
		value.name.trim().length < 1 ||
		value.name.trim().length > 60
	) {
		return {
			status: "invalid",
			reason: "Theme name must be 1 to 60 characters.",
		};
	}
	if (value.base !== "dark" && value.base !== "light") {
		return { status: "invalid", reason: "Theme base must be dark or light." };
	}
	if (!isRecord(value.colors) || Object.keys(value.colors).length === 0) {
		return {
			status: "invalid",
			reason: "Theme needs at least one color override.",
		};
	}
	if (
		Object.keys(value.colors).some(
			(key) => !themeTokenNames.some((token) => token === key),
		)
	) {
		return {
			status: "invalid",
			reason: "Theme contains an unknown color token.",
		};
	}
	const colors: Partial<Record<ThemeToken, string>> = {};
	for (const token of themeTokenNames) {
		if (!Object.hasOwn(value.colors, token)) continue;
		const color = value.colors[token];
		if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) {
			return {
				status: "invalid",
				reason: "Color overrides must use six-digit hex, such as #8cbbff.",
			};
		}
		colors[token] = color;
	}
	return {
		status: "valid",
		theme: {
			version: 1,
			name: value.name.trim(),
			base: value.base,
			colors,
		},
	};
}

export function parseCustomTheme(json: string): ThemeValidation {
	if (new TextEncoder().encode(json).byteLength > MAX_THEME_BYTES) {
		return {
			status: "invalid",
			reason: "Theme file must be 16 KiB or smaller.",
		};
	}
	try {
		const value: unknown = JSON.parse(json);
		return validateCustomTheme(value);
	} catch {
		return { status: "invalid", reason: "Theme file contains invalid JSON." };
	}
}

export async function loadCustomThemeFile(
	file: Pick<File, "size" | "text">,
): Promise<ThemeValidation> {
	if (file.size > MAX_THEME_BYTES) {
		return {
			status: "invalid",
			reason: "Theme file must be 16 KiB or smaller.",
		};
	}
	try {
		return parseCustomTheme(await file.text());
	} catch {
		return { status: "invalid", reason: "Could not read the theme file." };
	}
}

export function customThemeTokens(theme: CustomTheme): ThemeTokens {
	return { ...themes[theme.base], ...theme.colors };
}

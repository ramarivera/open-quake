import { type CustomTheme, isRecord, validateCustomTheme } from "./customTheme";
import type { BuiltinTheme } from "./tokens";

export const APPEARANCE_STORAGE_KEY = "open-quake.appearance.v1";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export type ThemeSelection = BuiltinTheme | "custom";
export type MotionPreference = "system" | "reduce";

export type Appearance = {
	readonly version: 1;
	readonly theme: ThemeSelection;
	readonly customTheme: CustomTheme | null;
	readonly motion: MotionPreference;
};

export const defaultAppearance: Appearance = {
	version: 1,
	theme: "dark",
	customTheme: null,
	motion: "system",
};

export function isThemeSelection(value: unknown): value is ThemeSelection {
	return value === "dark" || value === "light" || value === "custom";
}

export function isMotionPreference(value: unknown): value is MotionPreference {
	return value === "system" || value === "reduce";
}

export function selectReducedMotion(
	preference: MotionPreference,
	systemRequestsReduction: boolean,
): boolean {
	return systemRequestsReduction || preference === "reduce";
}

export function validateAppearance(value: unknown): Appearance | null {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		!isThemeSelection(value.theme) ||
		!isMotionPreference(value.motion) ||
		Object.keys(value).some(
			(key) => !["version", "theme", "customTheme", "motion"].includes(key),
		)
	) {
		return null;
	}
	const custom =
		value.customTheme === null ? null : validateCustomTheme(value.customTheme);
	if (custom?.status === "invalid") return null;
	const customTheme = custom?.theme ?? null;
	if (value.theme === "custom" && customTheme === null) return null;
	return {
		version: 1,
		theme: value.theme,
		customTheme,
		motion: value.motion,
	};
}

export function parseAppearance(json: string): Appearance | null {
	if (json.length > 20_480) return null;
	try {
		const value: unknown = JSON.parse(json);
		return validateAppearance(value);
	} catch {
		return null;
	}
}

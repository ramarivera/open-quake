import { type CustomTheme, isRecord, validateCustomTheme } from "./customTheme";
import type { BuiltinTheme } from "./tokens";

export const APPEARANCE_STORAGE_KEY = "open-quake.appearance.v2";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const LEGACY_APPEARANCE_STORAGE_KEY = "open-quake.appearance.v1";
export type FontScale = "small" | "medium" | "large";
export type ThemeSelection = BuiltinTheme | "custom";
export type MotionPreference = "system" | "reduce";

export type Appearance = {
	readonly version: 2;
	readonly fontScale: FontScale;
	readonly sidebarWidth: number | null;
	readonly theme: ThemeSelection;
	readonly customTheme: CustomTheme | null;
	readonly motion: MotionPreference;
};

export const defaultAppearance: Appearance = {
	version: 2,
	fontScale: "small",
	sidebarWidth: null,
	theme: "grey",
	customTheme: null,
	motion: "system",
};

export function isThemeSelection(value: unknown): value is ThemeSelection {
	return (
		value === "dark" ||
		value === "light" ||
		value === "custom" ||
		value === "grey"
	);
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
		(value.version !== 1 && value.version !== 2) ||
		!isThemeSelection(value.theme) ||
		!isMotionPreference(value.motion) ||
		Object.keys(value).some(
			(key) =>
				![
					"version",
					"theme",
					"customTheme",
					"motion",
					"fontScale",
					"sidebarWidth",
				].includes(key),
		)
	) {
		return null;
	}
	if (
		value.version === 2 &&
		(!["small", "medium", "large"].includes(String(value.fontScale)) ||
			(value.sidebarWidth !== null &&
				(typeof value.sidebarWidth !== "number" ||
					!Number.isFinite(value.sidebarWidth) ||
					value.sidebarWidth < 120 ||
					value.sidebarWidth > 360)))
	)
		return null;
	const fontScale =
		value.fontScale === "large"
			? "large"
			: value.fontScale === "medium"
				? "medium"
				: "small";
	const custom =
		value.customTheme === null ? null : validateCustomTheme(value.customTheme);
	if (custom?.status === "invalid") return null;
	const customTheme = custom?.theme ?? null;
	if (value.theme === "custom" && customTheme === null) return null;
	return {
		version: 2,
		fontScale,
		sidebarWidth:
			value.version === 2 && typeof value.sidebarWidth === "number"
				? value.sidebarWidth
				: null,
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

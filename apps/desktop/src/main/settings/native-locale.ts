import type { MenuItemConstructorOptions } from "electron";
import { resolveAppLocale } from "../../../../../packages/edge/src/settings/settings-invariants";
import strings from "../../shared/lifecycle-strings.json";

/** macOS uses the Dock menu as its native background-management entry. */
export function nativeLocaleMenu(
	locale: string,
	actions: {
		resume: () => void;
		settings: () => void;
		exit: () => void;
		management?: () => void;
	},
): MenuItemConstructorOptions[] {
	const text = strings.locales[resolveAppLocale(locale)].trayMenu;
	return [
		{ label: text.resume, click: actions.resume },
		{ label: text.setting, click: actions.settings },
		...(actions.management
			? [{ label: text.management, click: actions.management }]
			: []),
		{ type: "separator" },
		{ label: text.exit, click: actions.exit },
	];
}

import { expect, it, vi } from "vitest";
import strings from "../../shared/lifecycle-strings.json";
import { APP_LANGUAGES } from "../../shared/locale";
import { nativeLocaleMenu } from "./native-locale";

it("SETTINGS-064: native background menu reads each saved locale with English fallback and retains actions", () => {
	const actions = { resume: vi.fn(), settings: vi.fn(), exit: vi.fn() };
	for (const { value } of APP_LANGUAGES) {
		const menu = nativeLocaleMenu(value, actions);
		const expected = strings.locales[value].trayMenu;
		expect(menu.map((item) => item.label)).toEqual([
			expected.resume,
			expected.setting,
			undefined,
			expected.exit,
		]);
		expect(menu[0]?.click).toBe(actions.resume);
		expect(menu[1]?.click).toBe(actions.settings);
		expect(menu[3]?.click).toBe(actions.exit);
	}
	expect(nativeLocaleMenu("unknown", actions)).toEqual(
		nativeLocaleMenu("en", actions),
	);
	expect(actions.resume).not.toHaveBeenCalled();
	expect(actions.settings).not.toHaveBeenCalled();
	expect(actions.exit).not.toHaveBeenCalled();
});

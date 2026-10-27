import { GTProvider } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { keyText } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import {
	type AppDictionaries,
	appDictionaries,
	resolveAppLocale,
	useAppTranslations,
} from "./index";

function Probe() {
	const t = useAppTranslations("probe");
	return createElement("p", null, t("send"), "|", t("fallback"));
}
const bundled: AppDictionaries = {
	en: { probe: { send: "Send", fallback: "Source fallback" } },
	de: { probe: { send: "Senden" } },
};
describe("bundled General Translation", () => {
	it("renders translated strings and source fallback offline without translating user content", () => {
		const fetch = vi.fn(() => Promise.reject(new Error("Network forbidden")));
		vi.stubGlobal("fetch", fetch);
		try {
			const render = (locale: string) =>
				renderToStaticMarkup(
					createElement(
						GTProvider,
						{
							locale,
							translations: { en: {}, de: {} },
							dictionaries: bundled,
							_reload: () => {},
						},
						createElement(Probe),
					),
				);
			expect(render("en")).toContain("Send|Source fallback");
			expect(render("de")).toContain("Senden|Source fallback");
			expect(fetch).not.toHaveBeenCalled();
			expect(resolveAppLocale("de-CH")).toBe("de");
			expect(resolveAppLocale("es-ES")).toBe("es");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

function ProductCopyProbe() {
	const chat = useAppTranslations("chat");
	const runtime = useAppTranslations("agentHttp");
	const agents = useAppTranslations("agents");
	return createElement(
		"p",
		null,
		chat("send"),
		"|",
		runtime("addTitle"),
		"|",
		agents("clawAIConfig.addModel"),
	);
}
it("bundles the approved chat, runtime and agent namespaces offline", () => {
	const fetch = vi.fn(() => Promise.reject(new Error("Network forbidden")));
	vi.stubGlobal("fetch", fetch);
	try {
		const render = (locale: string) =>
			renderToStaticMarkup(
				createElement(
					GTProvider,
					{
						locale,
						translations: { en: {}, de: {} },
						dictionaries: appDictionaries,
						_reload: () => {},
					},
					createElement(ProductCopyProbe),
				),
			);
		expect(render("en")).toContain("Send|");
		expect(render("de")).toContain("Senden|");
		expect(render("de")).not.toContain("addTitle");
		expect(render("de")).not.toContain("clawAIConfig");
		for (const locale of ["zh", "es", "fr", "ko", "it", "ja"]) {
			expect(render(locale)).toContain("Send|");
			expect(render(locale)).not.toContain("addTitle");
			expect(render(locale)).not.toContain("clawAIConfig");
		}
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

function ProfileProgressProbe() {
	const t = useAppTranslations("settings");
	return createElement("p", null, t("setup.failure.profileProgress"));
}
it("bundles specific profile-progress failure feedback in all eight locales", () => {
	const messages = [
		"Profile visibility was saved",
		"Profilsichtbarkeit wurde gespeichert",
		"配置可见性已保存",
		"visibilidad de los perfiles",
		"visibilité des profils",
		"프로필 표시 설정",
		"visibilità dei profili",
		"プロファイルの表示設定",
	];
	for (const [index, locale] of [
		"en",
		"de",
		"zh",
		"es",
		"fr",
		"ko",
		"it",
		"ja",
	].entries()) {
		const rendered = renderToStaticMarkup(
			createElement(
				GTProvider,
				{
					locale,
					translations: {},
					dictionaries: appDictionaries,
					_reload: () => {},
				},
				createElement(ProfileProgressProbe),
			),
		);
		expect(rendered).toContain(messages[index]);
	}
});

it("bundles profile controls in every locale with the visible close label in its accessible name", () => {
	for (const locale of [
		"en",
		"de",
		"zh",
		"es",
		"fr",
		"ko",
		"it",
		"ja",
	] as const) {
		const picker = appDictionaries[locale]?.picker;
		expect(keyText("nextProfile", locale)).not.toBe("nextProfile");
		if (locale !== "en")
			expect(keyText("nextProfile", locale)).not.toBe("Next Profile");
		if (!picker || typeof picker === "string")
			throw new Error("Missing picker strings");
		const close = picker.profileClose,
			back = picker.profileReturn,
			search = picker.profileAppSearch;
		expect(typeof close).toBe("string");
		expect(typeof back).toBe("string");
		expect(typeof search).toBe("string");
		if (typeof close !== "string" || typeof back !== "string")
			throw new Error("Missing close label");
		expect(back).toContain(close);
		if (locale !== "en") expect(search).not.toBe("Search applications");
	}
});

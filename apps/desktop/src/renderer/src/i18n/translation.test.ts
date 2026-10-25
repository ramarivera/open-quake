import { GTProvider } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	type AppDictionaries,
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
			expect(resolveAppLocale("es-ES")).toBe("en");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

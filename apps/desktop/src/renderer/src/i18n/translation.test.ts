import { GTProvider } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
			expect(resolveAppLocale("es-ES")).toBe("en");
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
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

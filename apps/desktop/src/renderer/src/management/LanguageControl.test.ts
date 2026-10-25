import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { AppLocaleBridge } from "../i18n";
import { AppLocaleProvider } from "../i18n";
import { LanguageControl, useLanguageLabel } from "./LanguageControl";

afterEach(() => vi.unstubAllGlobals());

function withLocale(bridge: AppLocaleBridge | undefined) {
	return createElement(AppLocaleProvider, {
		bridge,
		// biome-ignore lint/correctness/noChildrenProp: the provider types children as a required prop, so createElement must receive it there.
		children: createElement(Probe),
	});
}

function Probe() {
	return createElement(
		"div",
		null,
		createElement("p", { id: "l" }, useLanguageLabel()),
		createElement(LanguageControl, { name: "lang", labelledBy: "l" }),
	);
}

it("offers each language by its own name with the saved locale selected", () => {
	vi.stubGlobal("window", {});
	const html = renderToStaticMarkup(withLocale(undefined));
	expect(html).toContain('<p id="l">Language</p>');
	expect(html).toMatch(/role="radiogroup" aria-labelledby="l"/);
	expect(html).toMatch(
		/<input type="radio" name="lang" value="en" checked=""|checked="" value="en"|value="en"[^>]*checked=""/,
	);
	expect(html).toContain("<span>English</span>");
	expect(html).toContain("<span>Deutsch</span>");
	expect(html).not.toContain('role="alert"');
});

it("disables the choice while the saved language loads from main", () => {
	const bridge: AppLocaleBridge = {
		read: () => new Promise(() => {}),
		set: async (locale) => ({ locale, revision: 1 }),
		subscribe: () => () => {},
		dispose: async () => {},
	};
	vi.stubGlobal("window", {});
	const html = renderToStaticMarkup(withLocale(bridge));
	expect(html).toMatch(/aria-disabled="true"/);
	expect(html.match(/disabled=""/g)).toHaveLength(2);
});

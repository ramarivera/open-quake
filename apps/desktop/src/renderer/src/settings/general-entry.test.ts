import { GTProvider } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { appDictionaries } from "../i18n";
import { GeneralSettings } from "./GeneralSettings";
import { createSetupStore } from "./stores";
import { fakeBridge } from "./test-fixtures";

it("keeps setup recovery reachable from General after its first read fails", async () => {
	const bridge = fakeBridge({
		wizard: vi.fn(() => Promise.reject({ code: "QUAKE.SETTINGS.READ_FAILED" })),
	});
	const setup = createSetupStore(bridge);
	await setup.load();
	expect(setup.getState()).toMatchObject({ status: "failed", snapshot: null });
	for (const locale of ["en", "de"] as const) {
		const html = renderToStaticMarkup(
			createElement(
				GTProvider,
				{
					locale,
					translations: { en: {}, de: {} },
					dictionaries: appDictionaries,
					_reload: () => {},
				},
				createElement(GeneralSettings, {
					setup,
					bridge,
					onOpenSetup: () => {},
				}),
			),
		);
		expect(html).toContain(
			locale === "en"
				? "The saved setup progress couldn’t be read."
				: "Der gespeicherte Einrichtungsfortschritt konnte nicht gelesen werden.",
		);
		expect(html).toMatch(
			locale === "en"
				? /<button[^>]*>Try again<\/button>/
				: /<button[^>]*>Erneut versuchen<\/button>/,
		);
	}
});

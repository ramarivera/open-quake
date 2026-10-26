// @vitest-environment happy-dom
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import {
	type AppLocaleBridge,
	AppLocaleProvider,
	type LocaleSnapshot,
} from "../i18n";
import { click, element, input, mount } from "./dom-test";
import { LanguageControl, useLanguageLabel } from "./LanguageControl";

function Probe({ id }: { id: string }) {
	return createElement(
		"section",
		{ id },
		createElement("p", { id: `${id}-label` }, useLanguageLabel()),
		createElement(LanguageControl, { name: id, labelledBy: `${id}-label` }),
		createElement("input", { defaultValue: "draft" }),
	);
}

it("MGMT-003 bootstraps two windows, propagates language and ignores a late older startup read", async () => {
	const listeners = new Set<(snapshot: LocaleSnapshot) => void>();
	let finishRead: (snapshot: LocaleSnapshot) => void = () => {};
	const initial = new Promise<LocaleSnapshot>((resolve) => {
		finishRead = resolve;
	});
	const off = vi.fn();
	const bridge: AppLocaleBridge = {
		read: () => initial,
		set: vi.fn(async (locale) => {
			const next = { locale, revision: 4 };
			for (const listener of listeners) listener(next);
			return next;
		}),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				off();
			};
		},
		dispose: async () => {},
	};
	const one = createElement(Probe, { id: "one" });
	const two = createElement(Probe, { id: "two" });
	const withLocale = (children: React.ReactNode) => {
		const props = { bridge, children };
		return createElement(AppLocaleProvider, props);
	};
	const first = await mount(withLocale(one), false);
	const second = await mount(withLocale(two), false);
	expect(element<HTMLInputElement>("input[name=one]").disabled).toBe(true);
	const draft = element<HTMLInputElement>("#two input:not([type=radio])");
	await input(draft, "unsaved workspace");
	await act(async () => {
		for (const listener of listeners) listener({ locale: "de", revision: 3 });
		finishRead({ locale: "en", revision: 1 });
	});
	expect(element("#one-label").textContent).toBe("Sprache");
	expect(element("#two-label").textContent).toBe("Sprache");
	expect(document.documentElement.lang).toBe("de");
	await click(element("#one input[value=en]"));
	expect(bridge.set).toHaveBeenCalledExactlyOnceWith("en");
	expect(element("#two-label").textContent).toBe("Language");
	expect(element<HTMLInputElement>("#two input:not([type=radio])")).toBe(draft);
	expect(draft.value).toBe("unsaved workspace");
	await first.unmount();
	await second.unmount();
	expect(off).toHaveBeenCalledTimes(2);
	expect(listeners.size).toBe(0);
});

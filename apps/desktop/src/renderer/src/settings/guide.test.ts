import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { pageLocation } from "../management/navigation";
import { GeneralSettings } from "./GeneralSettings";
import {
	GUIDE_PLACES,
	GUIDE_TOPICS,
	type GuideTopic,
	guideKeys,
	restoreFocus,
	stepTopic,
} from "./guide-content";
import { QuakeGuideDialog } from "./QuakeGuide";
import { SettingsRenderFixture } from "./render-fixture";
import { createSetupStore } from "./stores";
import strings from "./strings.json";

type Locale = "en" | "de";
const LOCALES: ReadonlyArray<Locale> = ["en", "de"];

function lookup(locale: Locale, key: string): unknown {
	let node: unknown = strings[locale].guide;
	for (const part of key.replace(/^guide\./, "").split(".")) {
		if (typeof node !== "object" || node === null || !(part in node))
			return undefined;
		node = Object.entries(node).find(([name]) => name === part)?.[1];
	}
	return node;
}
const placeholders = (text: string) =>
	[...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

const render = (locale: Locale, node: ReactNode) =>
	renderToStaticMarkup(
		createElement(SettingsRenderFixture, { app: null, locale, node }),
	);
const dialog = (
	topic: GuideTopic,
	onOpenPage?: (page: (typeof GUIDE_PLACES)[number]) => void,
) =>
	createElement(QuakeGuideDialog, {
		topic,
		onTopic: () => {},
		onClose: () => {},
		onOpenPage,
	});
const buttons = (html: string) =>
	[...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(
		([, attributes = "", inner = ""]) =>
			/aria-label="([^"]*)"/.exec(attributes)?.[1] ??
			inner.replace(/<[^>]+>/g, ""),
	);
const decode = (text: string) =>
	text.replaceAll("&amp;", "&").replaceAll("&quot;", '"');

describe("bundled QUAKE guide copy", () => {
	it("has every sentence the guide reads in English and German", () => {
		for (const key of guideKeys())
			for (const locale of LOCALES) {
				const value = lookup(locale, key);
				expect(typeof value, `${locale} ${key}`).toBe("string");
				expect(String(value).trim(), `${locale} ${key}`).not.toBe("");
			}
	});

	it("keeps the same placeholders in both languages", () => {
		for (const key of guideKeys())
			expect(placeholders(String(lookup("de", key))), key).toEqual(
				placeholders(String(lookup("en", key))),
			);
	});
});

describe("guide dialog", () => {
	it("renders every topic from bundled text, with no images or remote links", () => {
		for (const locale of LOCALES)
			for (const topic of GUIDE_TOPICS) {
				const html = render(locale, dialog(topic));
				expect(html).toContain(String(lookup(locale, "guide.title")));
				expect(decode(html)).toContain(
					String(lookup(locale, `guide.topics.${topic}.title`)),
				);
				expect(html).not.toMatch(/<img|<a\s|<iframe|https?:/);
			}
	});

	it("offers only reading and navigation controls, never a device action", () => {
		for (const locale of LOCALES) {
			const allowed = new Set([
				String(lookup(locale, "guide.close")),
				String(lookup(locale, "guide.previous")),
				String(lookup(locale, "guide.done")),
				...GUIDE_TOPICS.map((topic) =>
					String(lookup(locale, `guide.topics.${topic}.label`)),
				),
				...GUIDE_TOPICS.map((topic) =>
					String(lookup(locale, "guide.next")).replace(
						"{topic}",
						String(lookup(locale, `guide.topics.${topic}.label`)),
					),
				),
			]);
			for (const topic of GUIDE_TOPICS)
				for (const label of buttons(decode(render(locale, dialog(topic)))))
					expect(allowed, `${locale} ${topic} ${label}`).toContain(
						label.replace(/^\d+/, ""),
					);
		}
	});

	it("moves between topics without wrapping and ends with Done", () => {
		expect(stepTopic("start", -1)).toBe("start");
		expect(stepTopic("start", 1)).toBe("keys");
		expect(stepTopic("limits", 1)).toBe("limits");
		const first = buttons(render("en", dialog("start")));
		expect(first).not.toContain("Previous");
		expect(first).toContain("Next: Keys and profiles");
		const last = buttons(render("en", dialog("limits")));
		expect(last).toContain("Previous");
		expect(last).toContain("Done");
		expect(last.some((label) => label.startsWith("Next"))).toBe(false);
	});

	it("names places with the sidebar's labels and links them only when the root can navigate", () => {
		const keys = pageLocation("keys");
		const name = `${keys.section} › ${keys.label}`;
		const listed = decode(render("de", dialog("places")));
		expect(listed).toContain(name);
		expect(listed).not.toContain(`${name} öffnen`);
		const linked = buttons(
			decode(
				render(
					"de",
					dialog("places", () => {}),
				),
			),
		);
		expect(linked).toContain(`${name} öffnen`);
		expect(linked.filter((label) => label.endsWith(" öffnen"))).toHaveLength(
			GUIDE_PLACES.length,
		);
	});

	it("is reachable from General without the settings service", () => {
		const setup = createSetupStore(undefined);
		for (const locale of LOCALES) {
			const html = render(
				locale,
				createElement(GeneralSettings, {
					setup,
					bridge: undefined,
					onOpenSetup: () => {},
				}),
			);
			expect(html).toContain(String(lookup(locale, "guide.rowLabel")));
			expect(buttons(html)).toContain(String(lookup(locale, "guide.open")));
		}
	});
});

describe("guide focus restoration", () => {
	it("returns focus to the opener after dismissal while it is still shown", () => {
		const opener = { isConnected: true, focus: vi.fn() };
		expect(restoreFocus(opener, "dismiss")).toBe(true);
		expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
	});

	it("leaves focus to the destination page after navigation or removal", () => {
		const opener = { isConnected: true, focus: vi.fn() };
		expect(restoreFocus(opener, "navigate")).toBe(false);
		const removed = { isConnected: false, focus: vi.fn() };
		expect(restoreFocus(removed, "dismiss")).toBe(false);
		expect(restoreFocus(null, "dismiss")).toBe(false);
		expect(opener.focus).not.toHaveBeenCalled();
		expect(removed.focus).not.toHaveBeenCalled();
	});
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import profileLocales from "../../../../../../packages/device/src/profiles/builtins/locales.json";
import keyLocales from "../../../../../../packages/device/src/profiles/key-locales.json";
import { RuntimeErrors } from "../../../../../../packages/edge/src/agent-http/runtime-errors";
import { AiErrors } from "../../../../../../packages/edge/src/ai/ai-errors";
import { ChatErrors } from "../../../../../../packages/edge/src/chat/chat-errors";
import { APP_LANGUAGES } from "../../../shared/locale";
import { agentsCopy } from "../management/agents/locale-copy";
import { STRIP_STRINGS } from "../strip/overlays/voice/strings-table";
import catalogErrors from "./catalog-errors.json";
import { appDictionaries } from "./index";
import recovered from "./recovered.json";

const featureDictionaries = import.meta.glob<Record<string, unknown>>(
	"../**/strings.json",
	{ eager: true, import: "default" },
);

const rendererCatalogs = [AiErrors, ChatErrors, RuntimeErrors];

describe("renderer error copy", () => {
	it("localizes every AI, chat, and runtime catalog error in every app locale", () => {
		for (const locale of APP_LANGUAGES.map(({ value }) => value)) {
			const messages = catalogErrors[locale] as Readonly<
				Record<string, string>
			>;
			for (const catalog of rendererCatalogs) {
				for (const { code } of Object.values(catalog)) {
					const catalogCode = String(code);
					const message = messages[catalogCode];
					expect(message, `${locale}: ${catalogCode}`).toBeTruthy();
					expect(message, `${locale}: ${catalogCode}`).not.toContain(
						catalogCode,
					);
				}
			}
		}
	});

	it("keeps every profile activation label translated in every app locale", () => {
		const english = recovered.en.keysEditor;
		for (const locale of APP_LANGUAGES.map(({ value }) => value)) {
			const copy = recovered[locale].keysEditor;
			expect(Object.keys(copy).sort(), locale).toEqual(
				Object.keys(english).sort(),
			);
			for (const [key, value] of Object.entries(copy))
				expect(value, `${locale}: ${key}`).not.toBe(key);
		}
	});

	it("keeps every catalog error translation key present in every locale", () => {
		const expected = Object.keys(catalogErrors.en).sort();
		for (const locale of APP_LANGUAGES.map(({ value }) => value))
			expect(Object.keys(catalogErrors[locale]).sort(), locale).toEqual(
				expected,
			);
	});

	it("keeps recovered i18n keys translated in every supported locale", () => {
		const flatten = (tree: unknown, prefix = ""): string[] =>
			Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) =>
				typeof value === "string"
					? [`${prefix}${key}`]
					: flatten(value, `${prefix}${key}.`),
			);
		const englishKeys = flatten(recovered.en).sort();
		for (const locale of APP_LANGUAGES.map(({ value }) => value)) {
			const translated = new Set(flatten(recovered[locale]));
			for (const key of englishKeys)
				expect(translated.has(key), `${locale}: ${key}`).toBe(true);
		}
	});

	it("shows localized human copy instead of raw catalog codes", () => {
		for (const locale of APP_LANGUAGES.map(({ value }) => value)) {
			const message =
				catalogErrors[locale]["AGENT.HTTP.CAPABILITY.UNSUPPORTED"];
			expect(message).toBeTruthy();
			expect(message).not.toContain("AGENT.HTTP.CAPABILITY.UNSUPPORTED");
			expect(catalogErrors[locale].generic).not.toMatch(/^[A-Z0-9_.]+$/);
		}
	});
});

it("renders every bundled locale string without legacy DK-Claw names", () => {
	const strings = (tree: unknown): string[] => {
		if (typeof tree === "string") return [tree];
		if (!tree || typeof tree !== "object") return [];
		return Object.values(tree).flatMap(strings);
	};
	for (const { value: locale } of APP_LANGUAGES) {
		for (const value of strings([
			appDictionaries[locale],
			catalogErrors[locale],
			profileLocales[locale],
			keyLocales[locale],
			STRIP_STRINGS[locale],
			agentsCopy(locale),
			...Object.values(featureDictionaries).map((copy) => copy[locale]),
		])) {
			const rendered = renderToStaticMarkup(createElement("span", null, value));
			expect(rendered, `${locale}: ${value}`).not.toMatch(/DK[- ]?Claw|DK龙虾/);
		}
		expect(agentsCopy(locale).keyFields.title).not.toMatch(/OpenClaw|ClawBot/);
		expect(
			agentsCopy(locale).openclawRuntimeIndicator.shellNotConfigured,
		).not.toContain("OpenClaw");
	}
});

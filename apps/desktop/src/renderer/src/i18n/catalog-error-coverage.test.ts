import { describe, expect, it } from "vitest";
import { RuntimeErrors } from "../../../../../../packages/edge/src/agent-http/runtime-errors";
import { AiErrors } from "../../../../../../packages/edge/src/ai/ai-errors";
import { ChatErrors } from "../../../../../../packages/edge/src/chat/chat-errors";
import { APP_LANGUAGES } from "../../../shared/locale";
import catalogErrors from "./catalog-errors.json";
import recovered from "./recovered.json";

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

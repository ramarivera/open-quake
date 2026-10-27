import { expect, it } from "vitest";
import { loadSystemPrompts } from "./legacy-prompt-catalog.js";

it("AI-142/143 retains each allowed English/Chinese entry and prepends Default for all locales", () => {
	const en = loadSystemPrompts("en");
	expect(en).toHaveLength(167);
	expect(en[0]).toEqual({ id: "default", role: "Default", prompt: "" });
	expect(en[1]?.role).toBe("An Ethereum Developer");
	expect(en.some((e) => e.id === "en-61" || e.id === "en-151")).toBe(false);
	const zh = loadSystemPrompts("zh");
	expect(zh).toHaveLength(121);
	expect(
		zh.some((e) => ["zh-61", "zh-118", "zh-120", "zh-121"].includes(e.id)),
	).toBe(false);
	for (const locale of ["de", "fr", "es", "it", "ko", "ja", "unknown"])
		expect(loadSystemPrompts(locale)).toEqual(zh);
});
it("AI-143 parses CSV quotes, commas and multiline prompts and fails closed to Default on missing or malformed input", () => {
	expect(
		loadSystemPrompts("en", {
			en: '"act","prompt"\n"Quoted, role","A ""quote""\nnext line"\n',
		})[1],
	).toEqual({
		id: "en-0",
		role: "Quoted, role",
		prompt: 'A "quote"\nnext line',
	});
	for (const input of [
		{},
		{ en: '"act","prompt"\n"unterminated' },
		{ en: "act,prompt\nmissing" },
		{ zh: "{" },
		{ zh: '[{"act":"empty","prompt":""}]' },
	]) {
		for (const locale of ["en", "zh"])
			expect(loadSystemPrompts(locale, input)).toEqual([
				{ id: "default", role: "Default", prompt: "" },
			]);
	}
});

import { describe, expect, it } from "vitest";
import runtime from "../agent-http/strings.json";
import agents from "../agents/strings.json";
import chat from "./strings.json";

type Tree = { readonly [key: string]: string | Tree };
const flatten = (tree: Tree, prefix = ""): Record<string, string> =>
	Object.fromEntries(
		Object.entries(tree).flatMap(([key, value]) =>
			typeof value === "string"
				? [[`${prefix}${key}`, value]]
				: Object.entries(flatten(value, `${prefix}${key}.`)),
		),
	);
const placeholders = (value: string) =>
	[...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe.each([
	["chat", chat],
	["agentHttp", runtime],
	["agents", agents],
] as const)("%s dictionary", (_name, dictionary) => {
	const en = flatten(dictionary.en as Tree);
	const de = flatten(dictionary.de as Tree);
	it("has the same keys in English and German", () => {
		expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
	});
	it("keeps placeholders identical across locales", () => {
		for (const [key, value] of Object.entries(en))
			expect([key, placeholders(de[key] ?? "")]).toEqual([
				key,
				placeholders(value),
			]);
	});
});

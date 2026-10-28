import { Schema } from "effect";
import sources from "./legacy-prompt-sources.json";

const Entry = Schema.Struct({
	act: Schema.NonEmptyString,
	prompt: Schema.NonEmptyString,
});
export interface SystemPrompt {
	readonly id: string;
	readonly role: string;
	readonly prompt: string;
}
const DEFAULT: SystemPrompt = Object.freeze({
	id: "default",
	role: "Default",
	prompt: "",
});
/** Decision 12. Stable source indices, never renumbered after exclusions. */
const excluded = { en: new Set([61, 151]), zh: new Set([61, 118, 120, 121]) };

/** RFC4180 subset used by the bundled two-column prompt data, including quoted newlines. */
function csv(text: string): unknown {
	const rows: string[][] = [];
	let row: string[] = [],
		field = "",
		quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '"') {
			if (quoted && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (quoted || !field) quoted = !quoted;
			else throw new Error("invalid quote");
		} else if (!quoted && (ch === "," || ch === "\n")) {
			row.push(field.replace(/\r$/, ""));
			field = "";
			if (ch === "\n") {
				rows.push(row);
				row = [];
			}
		} else field += ch;
	}
	if (quoted) throw new Error("unterminated quote");
	if (field || row.length) {
		row.push(field.replace(/\r$/, ""));
		rows.push(row);
	}
	const header = rows.shift();
	if (header?.join(",") !== "act,prompt" || rows.some((r) => r.length !== 2))
		throw new Error("invalid columns");
	return rows.map((r) => ({ act: r[0], prompt: r[1] }));
}
/** Local catalogs only. Locales without their own source use English. */
export function loadSystemPrompts(
	locale: string,
	input: { readonly en?: string; readonly zh?: string } = sources,
): readonly SystemPrompt[] {
	const lang =
		locale.trim().toLowerCase().split(/[-_]/)[0] === "zh" ? "zh" : "en";
	try {
		const text = input[lang];
		if (!text) return [DEFAULT];
		const raw: unknown = lang === "en" ? csv(text) : JSON.parse(text);
		const entries = Schema.decodeUnknownSync(Schema.Array(Entry))(raw);
		return [
			DEFAULT,
			...entries.flatMap((e, index) =>
				excluded[lang].has(index)
					? []
					: [{ id: `${lang}-${index}`, role: e.act, prompt: e.prompt }],
			),
		];
	} catch {
		return [DEFAULT];
	}
}

import { Option } from "effect";

/** quakeToolCommandParse.js (AI-179): which tool cards expand, and into what. */
export type ToolKind = "exec" | "webSearch";

const EXEC = new Set(["exec", "bash", "shell", "run"]);
const SEARCH = new Set(["web_search", "websearch", "brave_search", "search"]);
const EXEC_ARGS = ["command", "cmd", "script", "input"] as const;
const SEARCH_ARGS = ["query", "q", "input", "search", "text"] as const;

export function toolKind(name: string): Option.Option<ToolKind> {
	const lower = name.trim().toLowerCase();
	if (EXEC.has(lower) || lower.endsWith("_exec")) return Option.some("exec");
	if (SEARCH.has(lower)) return Option.some("webSearch");
	return Option.none();
}

const parseArgs = (
	args: string,
): Option.Option<Readonly<Record<string, unknown>>> => {
	try {
		const value: unknown = JSON.parse(args);
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? Option.some(Object.fromEntries(Object.entries(value)))
			: Option.none();
	} catch {
		return Option.none();
	}
};

/** The command or query argument, else the JSON arguments, else the raw string. */
export function toolPreview(
	name: string,
	args: Option.Option<string>,
): Option.Option<string> {
	return Option.flatMap(toolKind(name), (kind) =>
		Option.flatMap(args, (raw) =>
			Option.match(parseArgs(raw), {
				onNone: () => (raw.trim() === "" ? Option.none() : Option.some(raw)),
				onSome: (record) => {
					const keys = kind === "exec" ? EXEC_ARGS : SEARCH_ARGS;
					for (const key of keys) {
						const value = record[key];
						if (typeof value === "string" && value.trim() !== "")
							return Option.some(value);
					}
					return Option.some(JSON.stringify(record, null, 2));
				},
			}),
		),
	);
}

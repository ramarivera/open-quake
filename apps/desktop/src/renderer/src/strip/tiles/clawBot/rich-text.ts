import { Option } from "effect";
import { safeHttpUrl } from "../../../../../shared/voice-surface";

/**
 * The strip's chat rich text (quakeChatMarkdown.js, quakeChatMessageSegments.js;
 * AI-172–AI-175) parsed into data. Rendering builds React elements from it,
 * so text is always escaped; nothing is ever passed as HTML.
 */
export type Inline =
	| { readonly _tag: "text"; readonly text: string }
	| { readonly _tag: "bold"; readonly children: readonly Inline[] }
	| { readonly _tag: "code"; readonly text: string }
	| { readonly _tag: "link"; readonly url: string; readonly label: string };
export type Block =
	| {
			readonly _tag: "heading";
			readonly level: number;
			readonly inlines: readonly Inline[];
	  }
	| { readonly _tag: "paragraph"; readonly inlines: readonly Inline[] }
	| {
			readonly _tag: "list";
			readonly ordered: boolean;
			readonly items: readonly (readonly Inline[])[];
	  }
	| { readonly _tag: "quote"; readonly inlines: readonly Inline[] }
	| { readonly _tag: "code"; readonly text: string };
export type RichText =
	| { readonly _tag: "plain"; readonly inlines: readonly Inline[] }
	| { readonly _tag: "markdown"; readonly blocks: readonly Block[] };

const BLOCK_START = /^(#{1,6} |[-*+] |\d+\. |> )/;
/** quakeChatMarkdown.js:14-25 */
export function looksLikeMarkdown(text: string): boolean {
	return (
		text.split("\n").some((line) => BLOCK_START.test(line.trimStart())) ||
		text.includes("```") ||
		/\*\*[^*]+\*\*/.test(text) ||
		/__[^_]+__/.test(text)
	);
}

/** host + path, ellipsis past 48 characters (QuakeLinkChipCard). */
export function linkLabel(url: string): string {
	const parsed = new URL(url);
	const label = `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
	return label.length > 48 ? `${label.slice(0, 48)}…` : label;
}

const URL_PATTERN =
	/\[([^\]\n]{1,200})\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s<>\])}"'*，。；：！？、）】》」』]+/g;
/** HTTP(S) only; file paths stay text (ai-chat-core, AI-175). */
export function linkSegments(text: string): readonly Inline[] {
	const result: Inline[] = [];
	let cursor = 0;
	for (const match of text.matchAll(URL_PATTERN)) {
		const start = match.index;
		const raw = (match[2] ?? match[0]).replace(/[.,;:!?*_~]+$/, "");
		const url = safeHttpUrl(raw);
		if (Option.isNone(url)) continue;
		const end =
			match[2] === undefined ? start + raw.length : start + match[0].length;
		if (start > cursor)
			result.push({ _tag: "text", text: text.slice(cursor, start) });
		result.push({ _tag: "link", url: url.value, label: linkLabel(url.value) });
		cursor = end;
	}
	if (cursor < text.length)
		result.push({ _tag: "text", text: text.slice(cursor) });
	return result;
}

/** `**bold**` / `__bold__` and `` `code` `` (quakeChatMarkdown.js:27-72). */
export function parseInline(text: string): readonly Inline[] {
	const result: Inline[] = [];
	const pattern = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > cursor)
			result.push(...linkSegments(text.slice(cursor, match.index)));
		if (match[1] !== undefined) result.push({ _tag: "code", text: match[1] });
		else
			result.push({
				_tag: "bold",
				children: linkSegments(match[2] ?? match[3] ?? ""),
			});
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) result.push(...linkSegments(text.slice(cursor)));
	return result;
}

/** Headings, paragraphs, flat lists, quotes and fenced code (quakeChatMarkdown.js:81-171). */
export function parseBlocks(text: string): readonly Block[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const blocks: Block[] = [];
	let paragraph: string[] = [];
	const flush = (): void => {
		if (paragraph.length > 0)
			blocks.push({
				_tag: "paragraph",
				inlines: parseInline(paragraph.join("\n")),
			});
		paragraph = [];
	};
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const trimmed = line.trimStart();
		if (trimmed.startsWith("```")) {
			flush();
			const code: string[] = [];
			index++;
			while (
				index < lines.length &&
				!(lines[index] ?? "").trimStart().startsWith("```")
			)
				code.push(lines[index++] ?? "");
			blocks.push({ _tag: "code", text: code.join("\n") });
			continue;
		}
		const heading = /^(#{1,6}) (.*)$/.exec(trimmed);
		if (heading) {
			flush();
			blocks.push({
				_tag: "heading",
				level: heading[1]?.length ?? 1,
				inlines: parseInline(heading[2] ?? ""),
			});
			continue;
		}
		const bullet = /^[-*+] (.*)$/.exec(trimmed);
		const numbered = /^\d+\. (.*)$/.exec(trimmed);
		if (bullet || numbered) {
			flush();
			const ordered = numbered !== null;
			const item = parseInline((bullet ?? numbered)?.[1] ?? "");
			const previous = blocks.at(-1);
			if (previous?._tag === "list" && previous.ordered === ordered)
				blocks[blocks.length - 1] = {
					...previous,
					items: [...previous.items, item],
				};
			else blocks.push({ _tag: "list", ordered, items: [item] });
			continue;
		}
		const quote = /^> ?(.*)$/.exec(trimmed);
		if (quote && trimmed.startsWith(">")) {
			flush();
			blocks.push({ _tag: "quote", inlines: parseInline(quote[1] ?? "") });
			continue;
		}
		if (trimmed === "") {
			flush();
			continue;
		}
		paragraph.push(line);
	}
	flush();
	return blocks;
}

export const parseRichText = (text: string): RichText =>
	looksLikeMarkdown(text)
		? { _tag: "markdown", blocks: parseBlocks(text) }
		: { _tag: "plain", inlines: linkSegments(text) };

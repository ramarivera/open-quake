import { Either, Schema } from "effect";
import { AiProtocolInvalid } from "../ai-errors.js";

const Source = Schema.Struct({
	title: Schema.optional(Schema.String),
	link: Schema.optional(Schema.String),
	url: Schema.optional(Schema.String),
});
const SearchFrame = Schema.Struct({
	web_search: Schema.optional(Schema.Array(Source)),
	search_info: Schema.optional(
		Schema.Struct({ search_results: Schema.Array(Source) }),
	),
});
export interface SearchSource {
	readonly title: string;
	readonly url: string;
}
/** Inline tap of bytes the SDK consumes, never a second request or background tee. */
export function collectSearchSources(
	response: Response,
	sources: SearchSource[],
): Response {
	if (!response.body) return response;
	let pending = "";
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const parse = (record: string) => {
		const data = record
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim())
			.join("\n");
		if (!data || data === "[DONE]") return;
		const decoded = Schema.decodeUnknownEither(Schema.parseJson(SearchFrame))(
			data,
		);
		if (Either.isLeft(decoded)) return;
		for (const item of [
			...(decoded.right.web_search ?? []),
			...(decoded.right.search_info?.search_results ?? []),
		]) {
			if (sources.length >= 16) break;
			const raw = item.link ?? item.url;
			if (!raw || raw.length > 2048) continue;
			const parsed = Either.try(() => new URL(raw));
			if (
				Either.isLeft(parsed) ||
				parsed.right.protocol !== "https:" ||
				parsed.right.username ||
				parsed.right.password
			)
				continue;
			const url = parsed.right.href
				.replaceAll("(", "%28")
				.replaceAll(")", "%29");
			if (sources.some((item) => item.url === url)) continue;
			sources.push({
				url,
				title: (item.title ?? parsed.right.hostname)
					.slice(0, 256)
					.replace(/[[\]\\]/g, " ")
					.split("")
					.map((char) => (char.charCodeAt(0) < 32 ? " " : char))
					.join(""),
			});
		}
	};
	const tap = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			pending += decoder.decode(chunk, { stream: true });
			if (pending.length > 1048576) throw new AiProtocolInvalid();
			let match = /\r?\n\r?\n/.exec(pending);
			while (match) {
				parse(pending.slice(0, match.index));
				pending = pending.slice(match.index + match[0].length);
				match = /\r?\n\r?\n/.exec(pending);
			}
			controller.enqueue(chunk);
		},
	});
	return new Response(response.body.pipeThrough(tap), {
		status: response.status,
		headers: response.headers,
	});
}

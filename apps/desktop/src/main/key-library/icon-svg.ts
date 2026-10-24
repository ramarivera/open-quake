/** A complete parser for the deliberately small, inert SVG icon subset. */
const elements = new Set([
	"svg",
	"g",
	"path",
	"circle",
	"ellipse",
	"rect",
	"polygon",
	"polyline",
	"line",
	"title",
	"desc",
	"defs",
	"clipPath",
]);
const attributes = new Set([
	"xmlns",
	"viewBox",
	"width",
	"height",
	"x",
	"y",
	"x1",
	"y1",
	"x2",
	"y2",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"d",
	"points",
	"fill",
	"stroke",
	"stroke-width",
	"fill-rule",
	"clip-rule",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"opacity",
	"fill-opacity",
	"stroke-opacity",
	"transform",
	"id",
	"version",
	"preserveAspectRatio",
	"stroke-dasharray",
	"stroke-dashoffset",
]);
const invalid = (): never => {
	throw new Error("Invalid icon pack");
};
export function safeIconSvg(source: string): string {
	if (
		source.length > 5 * 1024 * 1024 ||
		/<!|<\?|&|url\s*\(/i.test(source) ||
		[...source].some(
			(c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)),
		)
	)
		return invalid();
	const stack: string[] = [];
	let offset = 0,
		roots = 0,
		tokens = 0;
	while (offset < source.length) {
		if (++tokens > 50000) return invalid();
		if (source[offset] !== "<") {
			const end = source.indexOf("<", offset);
			const text = source.slice(offset, end < 0 ? source.length : end);
			if (text.trim() && !["title", "desc"].includes(stack.at(-1) ?? ""))
				return invalid();
			offset += text.length;
			continue;
		}
		const tag = /^<(\/?)([A-Za-z][A-Za-z0-9]*)(?=[\s/>])/.exec(
			source.slice(offset),
		);
		if (!tag || !elements.has(tag[2] ?? "")) return invalid();
		const name = tag[2] ?? "";
		offset += tag[0].length;
		if (tag[1]) {
			const end = /^\s*>/.exec(source.slice(offset));
			if (!end || stack.pop() !== name) return invalid();
			offset += end[0].length;
			continue;
		}
		if (!stack.length && (name !== "svg" || ++roots !== 1)) return invalid();
		if (stack.length && name === "svg") return invalid();
		const seen = new Set<string>();
		let selfClosing = false;
		for (;;) {
			const end = /^\s*(\/?)>/.exec(source.slice(offset));
			if (end) {
				selfClosing = end[1] === "/";
				offset += end[0].length;
				break;
			}
			// Leading whitespace is mandatory. Nothing between tags is skipped.
			const attr =
				/^\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/.exec(
					source.slice(offset),
				);
			if (!attr) return invalid();
			const key = attr[1] ?? "",
				value = attr[2] ?? attr[3] ?? "";
			if (!attributes.has(key) || seen.has(key)) return invalid();
			seen.add(key);
			if (key === "xmlns") {
				if (name !== "svg" || value !== "http://www.w3.org/2000/svg")
					return invalid();
			} else if (
				!/^[A-Za-z0-9#.,%+()\s_-]*$/.test(value) ||
				/(?:javascript|https?|data|url)\s*[:(]/i.test(value)
			)
				return invalid();
			offset += attr[0].length;
		}
		if (!selfClosing) stack.push(name);
		if (stack.length > 64) return invalid();
	}
	if (roots !== 1 || stack.length) return invalid();
	return source;
}

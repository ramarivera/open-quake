const hasUnsafeCharacters = (value: string): boolean =>
	Array.from(value).some(
		(character) =>
			character === "\\" ||
			character.charCodeAt(0) <= 32 ||
			character.charCodeAt(0) === 127,
	);
/** Pure URL policy. Never echoes rejected input into an error message. */
const unsafePath = (path: string): boolean => {
	if (hasUnsafeCharacters(path)) return true;
	return path.split("/").some((segment) => {
		try {
			const decoded = decodeURIComponent(segment);
			return (
				decoded === "." ||
				decoded === ".." ||
				decoded.includes("/") ||
				hasUnsafeCharacters(decoded) ||
				/%[0-9a-f]{2}/i.test(decoded)
			);
		} catch {
			return true;
		}
	});
};
export function normalizeRuntimeBaseURL(input: string): string | undefined {
	try {
		if (
			input !== input.trim() ||
			input.length > 4096 ||
			hasUnsafeCharacters(input) ||
			input.includes("?") ||
			input.includes("#")
		)
			return undefined;
		if (!/^https?:\/\/[^/]/i.test(input)) return undefined;
		const rawPath = input.replace(/^https?:\/\/[^/]+/i, "");
		if (unsafePath(rawPath)) return undefined;
		const url = new URL(input);
		if (!url.hostname || url.username || url.password || url.search || url.hash)
			return undefined;
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.href.endsWith("/") ? url.href : `${url.href}/`;
	} catch {
		return undefined;
	}
}
export function isRuntimeBaseURL(input: string): boolean {
	return normalizeRuntimeBaseURL(input) !== undefined;
}
/** Preserves base subpaths even when adapters use /v1/... paths. */
export function resolveRuntimeURL(
	baseURL: string,
	path: string,
): string | undefined {
	const normalized = normalizeRuntimeBaseURL(baseURL);
	if (
		!normalized ||
		path.startsWith("//") ||
		path.includes("#") ||
		/^[a-z][a-z0-9+.-]*:/i.test(path)
	)
		return undefined;
	const relative = path.startsWith("/") ? path.slice(1) : path;
	const pathname = relative.split("?")[0] ?? "";
	if (unsafePath(pathname) || hasUnsafeCharacters(relative)) return undefined;
	try {
		const base = new URL(normalized);
		const resolved = new URL(relative, base);
		return resolved.origin === base.origin &&
			resolved.pathname.startsWith(base.pathname)
			? resolved.href
			: undefined;
	} catch {
		return undefined;
	}
}

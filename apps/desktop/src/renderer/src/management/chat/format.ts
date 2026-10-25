/** Replaces `{key}` placeholders in localized copy. */
export const fill = (
	value: string,
	params: Readonly<Record<string, string | number>>,
): string =>
	value.replace(/\{(\w+)\}/g, (_match, key: string) =>
		String(params[key] ?? ""),
	);

const DAY = 86_400_000;
/** Compact relative time for conversation lists: "Just now", "5 min ago", "Yesterday", "12 Oct". */
export function relativeTime(
	updatedAt: number,
	now: number,
	locale: string,
	justNow: string,
): string {
	const elapsed = Math.max(0, now - updatedAt);
	if (elapsed < 60_000) return justNow;
	const relative = new Intl.RelativeTimeFormat(locale, {
		numeric: "auto",
		style: "short",
	});
	if (elapsed < 3_600_000)
		return relative.format(-Math.floor(elapsed / 60_000), "minute");
	if (elapsed < DAY)
		return relative.format(-Math.floor(elapsed / 3_600_000), "hour");
	if (elapsed < 2 * DAY) return relative.format(-1, "day");
	return new Intl.DateTimeFormat(locale, {
		day: "numeric",
		month: "short",
		...(now - updatedAt > 300 * DAY ? { year: "numeric" } : {}),
	}).format(updatedAt);
}

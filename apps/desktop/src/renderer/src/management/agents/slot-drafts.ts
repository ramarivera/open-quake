import type { Slots } from "../../../../shared/agents";

/** Preserve unsynced choices while adopting committed changes to untouched slots. */
export function reconcileSlotDrafts(
	draft: Slots,
	previous: Slots,
	next: Slots,
	agentIds: readonly string[],
): Slots {
	const value = (code: keyof Slots) =>
		draft[code] !== previous[code] && agentIds.includes(draft[code])
			? draft[code]
			: next[code];
	return {
		"1,5": value("1,5"),
		"1,6": value("1,6"),
		"2,5": value("2,5"),
		"2,6": value("2,6"),
	};
}

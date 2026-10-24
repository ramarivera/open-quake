/**
 * QBV handleVoiceTranscript (QBV:1488-1574, AI-164): merges cumulative ASR
 * partials into one live row. Streaming recognizers resend whole hypotheses,
 * shrink them, or start a new sentence after a break.
 */
export interface LiveTranscript {
	readonly text: string;
	/** The last partial as received, trimmed. */
	readonly last: string;
}
export const emptyTranscript: LiveTranscript = { text: "", last: "" };

const stripBoundary = (value: string): string =>
	value.replace(/[。，、；：！？．,;:!?…\s]+$/u, "");
const commonPrefix = (a: string, b: string): number => {
	const limit = Math.min(a.length, b.length);
	let index = 0;
	while (index < limit && a.charCodeAt(index) === b.charCodeAt(index)) index++;
	return index;
};
/** DK's guard against a short boundary prefix swallowing a long row. */
const collapses = (previous: string, prefix: string, next: string): boolean =>
	previous.length > 24 &&
	stripBoundary(prefix).length <= 10 &&
	next.length < previous.length * 0.55;

export function mergePartial(
	state: LiveTranscript,
	raw: string,
): LiveTranscript {
	const next = raw.trim();
	if (next === "" || next === state.last) return state;
	const previous = state.text;
	const trimmed = previous.trimEnd();
	const last = state.last;
	let text: string;
	if (last !== "" && next.length <= last.length && last.startsWith(next))
		text = next;
	else if (last !== "" && next.startsWith(last)) text = next;
	else if (
		last !== "" &&
		next.startsWith(stripBoundary(last)) &&
		!collapses(trimmed, last, next)
	)
		text = next;
	else if (
		trimmed !== "" &&
		next.startsWith(stripBoundary(trimmed)) &&
		!collapses(trimmed, trimmed, next)
	)
		text = next;
	else {
		const lcp = commonPrefix(trimmed, next);
		const shortTailAfterBreak =
			trimmed.length >= 18 &&
			next.length >= 2 &&
			next.length < trimmed.length * 0.88 &&
			lcp < Math.min(14, Math.max(3, Math.floor(trimmed.length * 0.12))) &&
			!trimmed.endsWith(next);
		const fullRefresh =
			!shortTailAfterBreak &&
			trimmed.length >= 4 &&
			next.length >= 8 &&
			next.length + 2 >= trimmed.length * 0.35 &&
			lcp >=
				Math.max(6, Math.floor(Math.min(trimmed.length, next.length) * 0.5));
		if (shortTailAfterBreak)
			text = trimmed + (trimmed.endsWith("\n") ? "" : "\n") + next;
		else if (fullRefresh) text = next;
		else text = previous + raw;
	}
	return { text, last: next };
}

/** A final transcript replaces the row outright (QBV:1494-1507). */
export function applyFinal(state: LiveTranscript, raw: string): LiveTranscript {
	const normalized = raw.replace(/\r\n?/g, "\n").trimEnd();
	return normalized === ""
		? state
		: { text: normalized, last: normalized.trim() };
}

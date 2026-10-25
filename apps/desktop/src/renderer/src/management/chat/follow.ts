/**
 * Keeps the newest message in view. On wide layouts the transcript is its own
 * scroll container; on narrow layouts the page scrolls and the composer is
 * sticky, so the transcript end is brought into the page viewport instead.
 * Narrow following only happens when the reader is already near the end or
 * just sent a message, so scrolling back through a streaming reply isn't yanked.
 */
export function revealEnd(
	transcript: HTMLElement,
	following: boolean,
	force: boolean,
): void {
	if (getComputedStyle(transcript).overflowY !== "visible") {
		if (following || force) transcript.scrollTop = transcript.scrollHeight;
		return;
	}
	const end = transcript.lastElementChild;
	if (!end) return;
	const nearEnd =
		transcript.getBoundingClientRect().bottom - window.innerHeight < 200;
	if (force || nearEnd) end.scrollIntoView({ block: "end" });
}

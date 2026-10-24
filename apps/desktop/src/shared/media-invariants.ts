import type { MediaIntent, MediaSnapshot } from "./weather-media-contracts";

export function canControlMedia(
	snapshot: MediaSnapshot,
	intent: MediaIntent,
): boolean {
	const session = snapshot.session;
	if (snapshot.error || !session) return false;
	if (intent === "next") return session.canNext;
	if (intent === "previous") return session.canPrevious;
	return session.playing ? session.canPause : session.canPlay;
}

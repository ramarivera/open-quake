import type { QuakeEvent } from "../../preload/quake";

/** The bus represents one selected QUAKE; loss invalidates its runtime before reconnect. */
export function resetKeysOnLinkLoss(
	event: QuakeEvent,
	reset: () => Promise<void>,
): Promise<void> {
	return event.kind === "status" && event.state !== "connected"
		? reset()
		: Promise.resolve();
}

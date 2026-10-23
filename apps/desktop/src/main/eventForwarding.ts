import { QUAKE_EVENT_CHANNEL, type QuakeEvent } from "../preload/quake";

type EventWindow = {
	isDestroyed(): boolean;
	webContents: {
		send(channel: typeof QUAKE_EVENT_CHANNEL, event: QuakeEvent): void;
	};
};

/** Read windows per event so replacements also receive the device stream. */
export function createEventForwarder(
	getWindows: () => readonly EventWindow[],
): (event: QuakeEvent) => void {
	return (event) => {
		for (const window of getWindows()) {
			if (!window.isDestroyed()) {
				window.webContents.send(QUAKE_EVENT_CHANNEL, event);
			}
		}
	};
}

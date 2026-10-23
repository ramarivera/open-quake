/** Shared IPC contract. Safe to import as a type from renderer code. */
export type QuakeEvent =
	| { source: "mock" | "hid"; kind: "rotate"; direction: 1 | -1 }
	| { source: "mock" | "hid"; kind: "press" }
	| {
			source: "mock" | "hid";
			kind: "touch";
			points: ReadonlyArray<{ action: number; x: number; y: number }>;
	  }
	| { source: "mock" | "hid"; kind: "keepalive"; seq: number };

export const QUAKE_EVENT_CHANNEL = "quake:event";

export type OpenQuakeBridge = {
	readonly version: string;
	onQuakeEvent(callback: (event: QuakeEvent) => void): () => void;
};

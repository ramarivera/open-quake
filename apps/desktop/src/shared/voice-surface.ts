// Voice surface contracts and pure rules, shared by main, preload and the
// strip renderer. Services and the mock runtime stay out of renderer bundles.
export * from "../../../../packages/edge/src/voice/surface/hold-to-talk";
export * from "../../../../packages/edge/src/voice/surface/voice-surface-contracts";
export { VoiceSurfaceRequestFailed } from "../../../../packages/edge/src/voice/surface/voice-surface-errors";
export * from "../../../../packages/edge/src/voice/surface/voice-surface-invariants";

export interface VoiceBridge {
	/** Subscribes to `voice:surface`; the callback receives undecoded values. */
	onEvent(callback: (event: unknown) => void): () => void;
	/** Sends one request; main decodes it and replies with `VoiceSurfaceReply`. */
	request(request: unknown): Promise<unknown>;
}
declare global {
	interface Window {
		quakeVoice?: VoiceBridge;
	}
}

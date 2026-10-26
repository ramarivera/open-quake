import { Context, type Effect, type Option } from "effect";
import type { ProviderProfile } from "../../ai/ai-contracts.js";
import type { HoldKeyType } from "./hold-to-talk.js";
import type {
	ToastKey,
	VoiceSurfaceEvent,
	VoiceTone,
} from "./voice-surface-contracts.js";
import type {
	VoiceKnobRejected,
	VoiceRuntimeUnavailable,
} from "./voice-surface-errors.js";

/**
 * Infrastructure the voice surface is injected with. Desktop main binds them
 * to Electron windows, the hardware layer and a voice runtime.
 */

/** Delivers one decoded event to every strip window. */
export class VoiceSurfacePublisher extends Context.Tag("VoiceSurfacePublisher")<
	VoiceSurfacePublisher,
	{ readonly publish: (event: VoiceSurfaceEvent) => Effect.Effect<void> }
>() {}

/**
 * hardware-controls' `HardwareControls.playTone` (PR #22) with the same four
 * names. It must return promptly; adapters queue the pattern themselves.
 */
export class VoiceTonePort extends Context.Tag("VoiceTonePort")<
	VoiceTonePort,
	{ readonly play: (serial: string, tone: VoiceTone) => Effect.Effect<void> }
>() {}

export interface PinnedDirectModel {
	readonly profile: ProviderProfile;
	readonly maxTokens: number;
}
export interface KnobCaptureSnapshot {
	readonly profileId: string;
	readonly revision: number;
	readonly route: "direct";
	readonly providerId: string;
	readonly modelId: string;
}
export interface CaptureRequest {
	/** Committed at the physical hold, never reconstructed from current UI selection. */
	readonly knob?: KnobCaptureSnapshot;
	readonly directModel?: PinnedDirectModel;
	readonly serial: string;
	readonly keyCode: string;
	readonly captureId: string;
	readonly generation: number;
	/** The grid key's type, or the knob voice key `0,1`. */
	readonly type: HoldKeyType | "knob";
	readonly agentId: Option.Option<string>;
}
export interface TextRequest {
	readonly knob?: KnobCaptureSnapshot;
	readonly directModel?: PinnedDirectModel;
	readonly serial: string;
	readonly keyCode: string;
	readonly agentId: string;
	readonly message: string;
}

/**
 * The runtime behind grid voice keys: knob-push-to-talk's capture/turn
 * service once it exists, the scripted mock in development. It publishes
 * stages, levels and chat back through `VoiceSurface`.
 */
export class GridVoiceRuntime extends Context.Tag("GridVoiceRuntime")<
	GridVoiceRuntime,
	{
		readonly resetContext?: (
			serial: string,
			keyCode: string,
		) => Effect.Effect<void, VoiceRuntimeUnavailable>;
		readonly select: (
			serial: string,
			keyCode: string,
			type: HoldKeyType,
			agentId: Option.Option<string>,
		) => Effect.Effect<void>;
		readonly startCapture: (
			request: CaptureRequest,
		) => Effect.Effect<void, VoiceRuntimeUnavailable | VoiceKnobRejected>;
		readonly releaseCapture: (
			serial: string,
			keyCode: string,
			generation: number,
		) => Effect.Effect<void>;
		readonly cancelCapture: (
			serial: string,
			keyCode: string,
			generation: number,
		) => Effect.Effect<void>;
		/** Audio may still drain after chat's terminal removed its visible flow. */
		readonly interruptOwner?: (
			serial: string,
		) => Effect.Effect<Option.Option<string>>;
		readonly cancelFlow: (
			serial: string,
			keyCode: string,
		) => Effect.Effect<void>;
		readonly sendText: (
			request: TextRequest,
		) => Effect.Effect<void, VoiceRuntimeUnavailable>;
	}
>() {}

/** Process-wide capture admission, evaluated before selection/reservation and again at acquisition. */
export class VoiceAdmission extends Context.Tag("VoiceAdmission")<
	VoiceAdmission,
	{
		readonly check: (
			serial: string,
			type: string,
		) => Effect.Effect<Option.Option<ToastKey>>;
	}
>() {}

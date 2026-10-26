import { Context, type Effect, type Option } from "effect";
import type { MeetingConfig, MeetingId } from "./meeting-contracts.js";
import type { MeetingError } from "./meeting-errors.js";

export interface CapturePort {
	/** Effective settings after acquisition, including an explicit source fallback. */
	readonly start: (
		id: MeetingId,
		config: MeetingConfig,
		parent: MeetingId | undefined,
	) => Effect.Effect<MeetingConfig, MeetingError>;
	/** Stop MediaRecorders and drain writes without converting audio. */
	readonly drain: (id: MeetingId) => Effect.Effect<void, MeetingError>;
	readonly duration: (id: MeetingId) => Effect.Effect<number, MeetingError>;
	readonly stop: (id: MeetingId) => Effect.Effect<void, MeetingError>;
	readonly cancel: (id: MeetingId) => Effect.Effect<void>;
	readonly stopTranslation: () => Effect.Effect<void>;
	readonly startTranslation: (
		config: MeetingConfig,
	) => Effect.Effect<void, MeetingError>;
	readonly mic: () => Effect.Effect<Option.Option<boolean>>;
	readonly toggleMic: () => Effect.Effect<void, MeetingError>;
}
export class MeetingCapture extends Context.Tag(
	"@open-quake/edge/MeetingCapture",
)<MeetingCapture, CapturePort>() {}

export interface MeetingOrigin {
	readonly serial: string;
	readonly keyCode: string;
}
export interface MeetingProgressEvent {
	readonly meetingId: MeetingId;
	readonly stage: number;
	readonly status: number;
	readonly origin?: MeetingOrigin | undefined;
}
/** Strip feedback is optional for headless meeting consumers. */
export class MeetingProgress extends Context.Tag(
	"@open-quake/edge/MeetingProgress",
)<
	MeetingProgress,
	{
		readonly publish: (event: MeetingProgressEvent) => Effect.Effect<void>;
	}
>() {}

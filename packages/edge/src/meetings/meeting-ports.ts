import { Context, type Effect, type Option } from "effect";
import type { MeetingConfig, MeetingId } from "./meeting-contracts.js";
import type { MeetingError } from "./meeting-errors.js";

export interface CapturePort {
	readonly start: (
		id: MeetingId,
		config: MeetingConfig,
		parent: MeetingId | undefined,
	) => Effect.Effect<void, MeetingError>;
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

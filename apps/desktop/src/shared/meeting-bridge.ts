import { Schema } from "effect";
import {
	MeetingCommand,
	MeetingReply,
} from "../../../../packages/edge/src/meetings/meeting-contracts";
import { MicrophoneIdentity } from "./speech";

export * from "../../../../packages/edge/src/meetings/meeting-contracts";
export const MEETING_REQUEST = "meetings:request";
export const MEETING_SNAPSHOT = "meetings:snapshot";
export const CAPTURE_REQUEST = "meetings:capture";
export const CAPTURE_READY = "meetings:capture-ready";
export const CAPTURE_REPLY = "meetings:capture-reply";
export const CAPTURE_CHUNK = "meetings:chunk";
export const CAPTURE_PCM = "meetings:pcm";
export const CAPTURE_LOST = "meetings:source-lost";
export const CaptureRequest = Schema.Struct({
	requestId: Schema.UUID,
	operation: Schema.Literal(
		"start",
		"stop",
		"cancel",
		"translate",
		"stopTranslation",
	),
	id: Schema.UUID,
	parentId: Schema.optional(Schema.UUID),
	microphoneId: Schema.String,
	microphone: Schema.optional(MicrophoneIdentity),
	platform: Schema.optional(Schema.Literal("win32", "darwin", "linux")),
	systemAudio: Schema.Boolean,
});
export type CaptureRequest = typeof CaptureRequest.Type;
export const CaptureReply = Schema.Struct({
	requestId: Schema.UUID,
	success: Schema.Boolean,
	reason: Schema.optional(Schema.Literal("systemUnavailable")),
});
export const CaptureChunk = Schema.Struct({
	id: Schema.UUID,
	track: Schema.Literal("mic", "system"),
	segment: Schema.Int.pipe(
		Schema.nonNegative(),
		Schema.lessThanOrEqualTo(1000),
	),
	bytes: Schema.Uint8ArrayFromSelf.pipe(
		Schema.filter((bytes) => bytes.length <= 4 * 1024 * 1024),
	),
});
export type CaptureChunk = typeof CaptureChunk.Type;
export interface MeetingsBridge {
	readonly audioSetup?: (request: {
		action: "status" | "install";
	}) => Promise<unknown>;
	readonly request: (command: MeetingCommand) => Promise<unknown>;
	readonly onSnapshot: (callback: (snapshot: unknown) => void) => () => void;
	readonly onCapture: (
		callback: (request: CaptureRequest) => void,
	) => () => void;
	readonly captureReply: (reply: typeof CaptureReply.Type) => void;
	readonly writeChunk: (chunk: CaptureChunk) => Promise<void>;
	readonly pcm: (bytes: Uint8Array) => Promise<void>;
	readonly sourceLost: (id: string) => void;
}
export const decodeMeetingReply = Schema.decodeUnknownEither(MeetingReply);
export const decodeMeetingCommand = Schema.decodeUnknownEither(MeetingCommand, {
	onExcessProperty: "error",
});
declare global {
	interface Window {
		readonly quakeMeetings?: MeetingsBridge;
	}
}

export { defaultMeetingConfig } from "../../../../packages/edge/src/meetings/meeting-defaults";
export {
	duration,
	formatTimer,
	marked,
	markRanges,
	timeline,
	transcriptText,
} from "../../../../packages/edge/src/meetings/meeting-invariants";
export { summaryTemplates } from "../../../../packages/edge/src/meetings/meeting-templates";

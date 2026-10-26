import * as Schema from "effect/Schema";
import { ChatChunk, SessionId, TurnId } from "../../chat/chat-contracts.js";

/**
 * What main publishes to the strip while a voice press runs: DK-Suite's
 * aiAssistStageChange / aiAssistAudioSpectrum / aiChatResponse family
 * (AI-077, KNOB-054, SCREEN-116) as one decoded union. See
 * openspec/changes/strip-voice-ui/design.md "Voice surface events".
 */

/** The logical knob voice key; its stages drive the full-screen overlay (QSV:2002). */
export const KNOB_VOICE_KEY = "0,1";

/** A profile coordinate `row,col` or the knob voice key `0,1`. */
export const VoiceKeyCode = Schema.String.pipe(
	Schema.pattern(/^\d{1,2},\d{1,2}$/),
);
export type VoiceKeyCode = typeof VoiceKeyCode.Type;

const Serial = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128));
const CaptureId = Schema.String.pipe(
	Schema.minLength(1),
	Schema.maxLength(128),
);
/** Transcripts and messages are display text, bounded so one event stays small. */
const DisplayText = Schema.String.pipe(Schema.maxLength(8000));

export const RecordingStatus = Schema.Literal(
	"preparing",
	"listening",
	"speaking",
	"recording",
);
export type RecordingStatus = typeof RecordingStatus.Type;
/** DK errType 0–4 plus open-quake's missing-runtime case. */
export const FailureReason = Schema.Literal(
	"generic",
	"noMic",
	"server",
	"processing",
	"timeout",
	"unavailable",
);
export type FailureReason = typeof FailureReason.Type;
export const IdleOutcome = Schema.Literal("completed", "empty", "cancelled");
export type IdleOutcome = typeof IdleOutcome.Type;

/** DK stage 1/2/3/4/0 with readable phases (design.md stage table). */
export const VoiceStage = Schema.Union(
	Schema.TaggedStruct("recording", {
		status: RecordingStatus,
		transcript: Schema.optional(DisplayText),
	}),
	Schema.TaggedStruct("processing", {
		transcript: Schema.optional(DisplayText),
	}),
	Schema.TaggedStruct("failed", {
		reason: FailureReason,
		errorCode: Schema.optional(Schema.String.pipe(Schema.maxLength(64))),
		message: Schema.optional(DisplayText),
	}),
	Schema.TaggedStruct("busy", { message: Schema.optional(DisplayText) }),
	Schema.TaggedStruct("idle", {
		outcome: IdleOutcome,
		emptyReason: Schema.optional(Schema.Literal("noAudio", "unclear")),
	}),
);
export type VoiceStage = typeof VoiceStage.Type;

export const ToastKey = Schema.Literal(
	"aiIconViewTxt.busyToast",
	"aiAudio.prevTurnBusy",
	"aiAudio.openClawGatewayNotRunning",
	"aiAudio.openClawGatewayStarting",
	"aiAudio.openClawNotReady",
	"aiAudio.busyOnGrid",
);
export type ToastKey = typeof ToastKey.Type;
/** DK ALERT_TYPE_STOP 0, INVALID 1, CHECKMARK 3; ALARM 2 never shows (DEV:143-167). */
export const KeyAlertKind = Schema.Literal("stop", "invalid", "checkmark");
export type KeyAlertKind = typeof KeyAlertKind.Type;
export const AgentConnection = Schema.Literal(
	"checking",
	"noService",
	"connecting",
	"connected",
	"disconnected",
);
export type AgentConnection = typeof AgentConnection.Type;
export const AgentRef = Schema.Struct({
	id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
	name: Schema.String.pipe(Schema.maxLength(128)),
	/** DK agentIcon `0-128`-style resource id; its last digit picks the gradient (AI-158). */
	icon: Schema.optional(Schema.String.pipe(Schema.maxLength(32))),
});
export type AgentRef = typeof AgentRef.Type;
export const ToolPhase = Schema.Literal("start", "result", "error");
export type ToolPhase = typeof ToolPhase.Type;

export const VoiceResetReason = Schema.Literal(
	"profileChanged",
	"disconnected",
);
export type VoiceResetReason = typeof VoiceResetReason.Type;

export const VoiceSurfaceEvent = Schema.Union(
	Schema.TaggedStruct("Reset", { serial: Serial, reason: VoiceResetReason }),
	Schema.TaggedStruct("Stage", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		captureId: CaptureId,
		stage: VoiceStage,
	}),
	Schema.TaggedStruct("Level", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		captureId: CaptureId,
		rms: Schema.Number.pipe(Schema.between(0, 1)),
		speaking: Schema.Boolean,
	}),
	Schema.TaggedStruct("TurnStarted", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		sessionId: SessionId,
		turnId: TurnId,
		prompt: DisplayText,
		source: Schema.Literal("voice", "typed"),
		agent: Schema.optional(AgentRef),
	}),
	Schema.TaggedStruct("Chunk", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		chunk: ChatChunk,
	}),
	Schema.TaggedStruct("Tool", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		turnId: TurnId,
		toolCallId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
		name: Schema.String.pipe(Schema.maxLength(128)),
		phase: ToolPhase,
		args: Schema.optional(DisplayText),
		output: Schema.optional(DisplayText),
	}),
	Schema.TaggedStruct("KeyPress", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		action: Schema.Literal("down", "up"),
	}),
	Schema.TaggedStruct("KeyAlert", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		alert: KeyAlertKind,
	}),
	Schema.TaggedStruct("Toast", {
		serial: Serial,
		messageKey: ToastKey,
		name: Schema.optional(Schema.String.pipe(Schema.maxLength(128))),
	}),
	Schema.TaggedStruct("AgentStatus", { state: AgentConnection }),
	/** AI-155: playback is independent from capture and chat generation. */
	Schema.TaggedStruct("ReadAloudState", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		sessionId: CaptureId,
		phase: Schema.Literal("idle", "thinking", "speaking"),
	}),
	/** DK mmStageChange (AI-267). Meeting tiles (cluster 15) consume it. */
	Schema.TaggedStruct("MeetingStage", {
		serial: Serial,
		keyCode: VoiceKeyCode,
		meetingId: Schema.Union(Schema.Int.pipe(Schema.nonNegative()), Schema.UUID),
		stage: Schema.Int.pipe(Schema.between(0, 5)),
		status: Schema.Int.pipe(Schema.between(0, 2)),
	}),
);
export type VoiceSurfaceEvent = typeof VoiceSurfaceEvent.Type;
export type StageEvent = Extract<VoiceSurfaceEvent, { _tag: "Stage" }>;
export type LevelEvent = Extract<VoiceSurfaceEvent, { _tag: "Level" }>;

/** Raw strip input for hold-to-talk keys, renderer → main. */
export const GridVoiceInput = Schema.Struct({
	keyCode: VoiceKeyCode,
	kind: Schema.Literal("down", "touchEnd", "touchCancel", "up"),
	/** The up came from a real touch end (QSV:2920). */
	voiceTouchEnd: Schema.optional(Schema.Boolean),
	/** The key's tile type, `aiChat` or `clawbot`. */
	type: Schema.Literal("aiChat", "clawbot"),
	/** False selects a typed-only clawbot assistant without arming capture. */
	voiceInput: Schema.optional(Schema.Boolean),
	/** Clawbot agent id from the key's actions, for selection. */
	agentId: Schema.optional(Schema.String.pipe(Schema.maxLength(128))),
});
export type GridVoiceInput = typeof GridVoiceInput.Type;

/** Everything the strip may ask main to do (renderer → main), decoded at the IPC edge. */
export const VoiceSurfaceRequest = Schema.Union(
	Schema.TaggedStruct("Input", { input: GridVoiceInput }),
	Schema.TaggedStruct("Reset", {
		reason: VoiceResetReason,
	}),
	Schema.TaggedStruct("SendText", {
		keyCode: VoiceKeyCode,
		agentId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
		message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(8000)),
	}),
	Schema.TaggedStruct("OpenLink", {
		url: Schema.String.pipe(Schema.maxLength(2048)),
	}),
	Schema.TaggedStruct("CopyText", {
		text: Schema.String.pipe(Schema.maxLength(200_000)),
	}),
	Schema.TaggedStruct("PickFiles", {}),
	Schema.TaggedStruct("FocusPanel", {}),
	Schema.TaggedStruct("ReadAloud", { keyCode: VoiceKeyCode }),
	/** A window subscribed; main answers with the current agent status. */
	Schema.TaggedStruct("Hello", {}),
);
export type VoiceSurfaceRequest = typeof VoiceSurfaceRequest.Type;
export const VoiceSurfaceReply = Schema.Union(
	Schema.TaggedStruct("ok", {}),
	Schema.TaggedStruct("files", {
		paths: Schema.Array(Schema.String.pipe(Schema.maxLength(4096))),
	}),
	Schema.TaggedStruct("rejected", {
		code: Schema.String.pipe(Schema.maxLength(64)),
	}),
);
export type VoiceSurfaceReply = typeof VoiceSurfaceReply.Type;

/** hardware-controls' playTone names (PR #22) minus its settings preview. */
export const VoiceTone = Schema.Literal("start", "end", "error", "busy");
export type VoiceTone = typeof VoiceTone.Type;

export const VOICE_SURFACE_CHANNEL = "voice:surface";
export const VOICE_REQUEST_CHANNEL = "voice:request";

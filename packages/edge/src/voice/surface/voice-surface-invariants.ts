import { Option } from "effect";
import {
	type KeyAlertKind,
	KNOB_VOICE_KEY,
	type StageEvent,
	type VoiceStage,
	type VoiceTone,
} from "./voice-surface-contracts.js";

/** Pure rules behind the voice surface (design.md); no Effect, no IO. */

export const isKnobVoiceKey = (keyCode: string): boolean =>
	keyCode === KNOB_VOICE_KEY;

/** Structural shape of a profile key; edge does not import the device domain. */
export interface HoldToTalkCandidate {
	readonly type: string;
	readonly aiConfigData?: unknown;
	readonly assistantSettings?:
		| { readonly enableVoiceInput: boolean }
		| undefined;
	readonly actions: ReadonlyArray<{
		readonly type: string;
		readonly value: unknown;
	}>;
}
/** `aiChat`, or `clawbot` with a truthy voiceInput action (QSC:1758-1767, BG@1099686). */
export const isHoldToTalkKey = (key: HoldToTalkCandidate): boolean =>
	(key.type === "aiChat" &&
		(!key.aiConfigData || Boolean(key.assistantSettings)) &&
		key.assistantSettings?.enableVoiceInput !== false) ||
	(key.type === "clawbot" &&
		key.actions.some(
			(action) => action.type === "voiceInput" && Boolean(action.value),
		));

export const sameStage = (a: VoiceStage, b: VoiceStage): boolean => {
	switch (a._tag) {
		case "recording":
			return (
				b._tag === "recording" &&
				a.status === b.status &&
				a.transcript === b.transcript
			);
		case "processing":
			return b._tag === "processing" && a.transcript === b.transcript;
		case "failed":
			return (
				b._tag === "failed" &&
				a.reason === b.reason &&
				a.errorCode === b.errorCode &&
				a.message === b.message
			);
		case "busy":
			return b._tag === "busy" && a.message === b.message;
		case "idle":
			return (
				b._tag === "idle" &&
				a.outcome === b.outcome &&
				a.emptyReason === b.emptyReason
			);
	}
};

/** Recording and processing hold the voice slot; the rest end or reject a press. */
export const isActiveStage = (stage: VoiceStage): boolean =>
	stage._tag === "recording" || stage._tag === "processing";

/** What main remembers about the latest capture on one device. */
export interface CaptureMemory {
	readonly keyCode: string;
	readonly captureId: string;
	readonly last: VoiceStage;
	readonly listened: boolean;
	readonly ended: boolean;
}
export interface Feedback {
	readonly tones: readonly VoiceTone[];
	readonly alert: Option.Option<{
		readonly keyCode: string;
		readonly alert: KeyAlertKind;
	}>;
}
export interface StageStep {
	/** False when the stage repeats the previous one and must not be re-published. */
	readonly publish: boolean;
	readonly memory: CaptureMemory;
	readonly feedback: Feedback;
}

const none: Feedback = { tones: [], alert: Option.none() };
const withAlert = (event: StageEvent, tone: VoiceTone): Feedback => ({
	tones: [tone],
	// The knob key has no tile to flash (AIManager.js:1402).
	alert: isKnobVoiceKey(event.keyCode)
		? Option.none()
		: Option.some({ keyCode: event.keyCode, alert: "invalid" }),
});

/**
 * Dedupe plus the design.md feedback table: start on the first listening
 * stage, end on idle completed/empty, error and busy with a key alert.
 */
export function stepStage(
	previous: Option.Option<CaptureMemory>,
	event: StageEvent,
): StageStep {
	const same = Option.filter(
		previous,
		(memory) =>
			memory.captureId === event.captureId && memory.keyCode === event.keyCode,
	);
	if (Option.isSome(same) && sameStage(same.value.last, event.stage))
		return { publish: false, memory: same.value, feedback: none };
	const memory: CaptureMemory = Option.getOrElse(same, () => ({
		keyCode: event.keyCode,
		captureId: event.captureId,
		last: event.stage,
		listened: false,
		ended: false,
	}));
	const stage = event.stage;
	const next = { ...memory, last: stage };
	switch (stage._tag) {
		case "recording":
			if (stage.status === "listening" && !memory.listened && !memory.ended)
				return {
					publish: true,
					memory: { ...next, listened: true },
					feedback: { tones: ["start"], alert: Option.none() },
				};
			return { publish: true, memory: next, feedback: none };
		case "processing":
			return { publish: true, memory: next, feedback: none };
		case "idle":
			return {
				publish: true,
				memory: { ...next, ended: true },
				feedback:
					stage.outcome === "cancelled" || memory.ended
						? none
						: { tones: ["end"], alert: Option.none() },
			};
		case "failed":
			return {
				publish: true,
				memory: { ...next, ended: true },
				feedback: memory.ended ? none : withAlert(event, "error"),
			};
		case "busy":
			return {
				publish: true,
				memory: next,
				feedback: withAlert(event, "busy"),
			};
	}
}

/**
 * AI Copilot statuses for grid stages (QSV:1870-1918): −1 error, 0
 * initializing, 1 processing, 2 completed, 3 start recording, 5 busy.
 */
export type TileStatus = -1 | 0 | 1 | 2 | 3 | 4 | 5;
export const tileStatusFor = (stage: VoiceStage): Option.Option<TileStatus> => {
	switch (stage._tag) {
		case "recording":
			return Option.some(stage.status === "preparing" ? 0 : 3);
		case "processing":
			return Option.none();
		case "failed":
			return Option.some(-1);
		case "busy":
			return Option.some(5);
		case "idle":
			return Option.some(2);
	}
};

/** Level meter (AudioHandler, KNOB-054): analyser RMS ×3.5, clamped. */
export const meterLevel = (input: {
	readonly analyserRms: number;
	readonly peak: number;
}): { readonly rms: number; readonly speaking: boolean } => {
	const raw = Number.isFinite(input.analyserRms) ? input.analyserRms : 0;
	const rms = Math.max(0, Math.min(1, raw * 3.5));
	const speaking = rms > 0.05 || input.peak > 0.15;
	return { rms: speaking ? rms : rms * 0.35, speaking };
};
export const levelInterval = (speaking: boolean): number =>
	speaking ? 50 : 180;
/** One Level per 50 ms while speaking, per 180 ms while silent. */
export const shouldEmitLevel = (
	lastEmittedAt: Option.Option<number>,
	now: number,
	speaking: boolean,
): boolean =>
	Option.match(lastEmittedAt, {
		onNone: () => true,
		onSome: (last) => now - last >= levelInterval(speaking),
	});

/** VAD (KNOB-050): detected above a 15 % peak, cleared after 15 quiet buffers. */
export interface VoiceActivity {
	readonly detected: boolean;
	readonly quietBuffers: number;
}
export const initialVoiceActivity: VoiceActivity = {
	detected: false,
	quietBuffers: 0,
};
export const stepVoiceActivity = (
	state: VoiceActivity,
	peak: number,
): VoiceActivity => {
	if (peak > 0.15) return { detected: true, quietBuffers: 0 };
	const quietBuffers = state.quietBuffers + 1;
	return {
		detected: state.detected && quietBuffers < 15,
		quietBuffers,
	};
};

/** Opens only http(s) URLs with a host and no credentials (ai-chat-core, AI-177). */
export const safeHttpUrl = (raw: string): Option.Option<string> => {
	if (!URL.canParse(raw)) return Option.none();
	const url = new URL(raw);
	return (url.protocol === "http:" || url.protocol === "https:") &&
		url.hostname !== "" &&
		url.username === "" &&
		url.password === ""
		? Option.some(url.href)
		: Option.none();
};

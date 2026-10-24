import { Option } from "effect";
import {
	isKnobVoiceKey,
	type LevelEvent,
	type RecordingStatus,
	type StageEvent,
} from "../../../../../shared/voice-surface";
import type { StripStringKey } from "./strings";

/**
 * The full-screen voice overlay and the mic bar as pure state
 * (strip-voice-ui "Voice stage texts and countdown", QSV:1805-2157).
 */

/** Overlay text is structured so a locale change re-renders it. */
export type VoiceText =
	| { readonly _tag: "transcript"; readonly text: string }
	| { readonly _tag: "string"; readonly key: StripStringKey }
	| { readonly _tag: "errorCode"; readonly code: string };

const PLACEHOLDERS: ReadonlySet<StripStringKey> = new Set([
	"aiAudio.preparingRecord",
	"aiAudio.preparingMic",
	"aiAudio.speakNow",
	"aiAudio.recording",
]);
const message = (key: StripStringKey): VoiceText => ({ _tag: "string", key });
const transcript = (text: string | undefined): Option.Option<VoiceText> => {
	const trimmed = (text ?? "").trim();
	return trimmed === ""
		? Option.none()
		: Option.some({ _tag: "transcript", text: trimmed });
};

/** QSV resolveStage1MicTranscript, minus DK's knob "Preparing to record…" relapse. */
export function recordingText(
	status: RecordingStatus,
	partial: string | undefined,
	current: Option.Option<VoiceText>,
	knob: boolean,
): VoiceText {
	if (status === "preparing")
		return message(knob ? "aiAudio.preparingRecord" : "aiAudio.preparingMic");
	return Option.getOrElse(transcript(partial), () => {
		if (status === "listening") return message("aiAudio.speakNow");
		return Option.getOrElse(
			Option.filter(
				current,
				(text) => !(text._tag === "string" && PLACEHOLDERS.has(text.key)),
			),
			() => message("aiAudio.recording"),
		);
	});
}

export interface OverlayState {
	readonly visible: boolean;
	readonly captureId: Option.Option<string>;
	readonly reachedProcessing: boolean;
	readonly text: Option.Option<VoiceText>;
	readonly busyUntil: Option.Option<number>;
	/** "(3S)" … "(1S)" after a failure; the overlay closes when it runs out. */
	readonly countdown: Option.Option<{
		readonly base: VoiceText;
		readonly remaining: number;
	}>;
}
export const initialOverlay: OverlayState = {
	visible: false,
	captureId: Option.none(),
	reachedProcessing: false,
	text: Option.none(),
	busyUntil: Option.none(),
	countdown: Option.none(),
};

export const ERROR_COUNTDOWN_SECONDS = 3;
export const BUSY_OVERLAY_MS = 3000;

const failureText = (stage: Extract<StageEvent["stage"], { _tag: "failed" }>) =>
	Option.getOrElse(transcript(stage.message), () =>
		stage.errorCode === undefined
			? message("aiAudio.error")
			: { _tag: "errorCode" as const, code: stage.errorCode },
	);

/** Knob-key stages (and keyless ones) drive the backdrop. */
export function reduceOverlay(
	state: OverlayState,
	event: StageEvent,
	now = 0,
): OverlayState {
	const stage = event.stage;
	const sameCapture = Option.contains(state.captureId, event.captureId);
	// A stale idle from an older capture changes nothing.
	if (!sameCapture && stage._tag === "idle") return state;
	const session: OverlayState = sameCapture
		? state
		: { ...initialOverlay, captureId: Option.some(event.captureId) };
	const next: OverlayState = {
		...session,
		countdown: Option.none(),
		busyUntil: Option.none(),
	};
	switch (stage._tag) {
		case "recording":
			// Recording news that arrives after processing is late (QSV:2042).
			if (session.reachedProcessing) return session;
			return {
				...next,
				visible: true,
				text: Option.some(
					recordingText(stage.status, stage.transcript, session.text, true),
				),
			};
		case "processing":
			return {
				...next,
				visible: true,
				reachedProcessing: true,
				text: Option.some(
					Option.getOrElse(transcript(stage.transcript), () =>
						message("aiAudio.processing"),
					),
				),
			};
		case "failed": {
			const base = failureText(stage);
			return {
				...next,
				visible: true,
				text: Option.some(base),
				countdown: Option.some({
					base,
					remaining: ERROR_COUNTDOWN_SECONDS,
				}),
			};
		}
		case "busy":
			return {
				...next,
				visible: true,
				busyUntil: Option.some(now + BUSY_OVERLAY_MS),
				text: Option.some(
					Option.getOrElse(transcript(stage.message), () =>
						message("aiAudio.busy"),
					),
				),
			};
		case "idle":
			return { ...initialOverlay, captureId: Option.some(event.captureId) };
	}
}

export function expireOverlay(state: OverlayState, now: number): OverlayState {
	return Option.exists(state.busyUntil, (until) => now >= until)
		? { ...initialOverlay, captureId: state.captureId }
		: state;
}

/** One second of the error countdown (QSV:2140-2156). */
export function tickCountdown(state: OverlayState): OverlayState {
	return Option.match(state.countdown, {
		onNone: () => state,
		onSome: ({ base, remaining }) =>
			remaining - 1 >= 1
				? {
						...state,
						countdown: Option.some({ base, remaining: remaining - 1 }),
					}
				: { ...initialOverlay, captureId: state.captureId },
	});
}

/** The mic bar: knob or grid key, recording stages only (SMB, QSV:1805-1858). */
export interface BarState {
	readonly visible: boolean;
	readonly keyCode: string;
	readonly captureId: string;
	readonly rms: number;
	readonly speaking: boolean;
	/** Grid voice only: the 52 px transcript row above the canvas. */
	readonly text: Option.Option<VoiceText>;
}
export const initialBar: BarState = {
	visible: false,
	keyCode: "",
	captureId: "",
	rms: 0,
	speaking: false,
	text: Option.none(),
};

export function reduceBarStage(state: BarState, event: StageEvent): BarState {
	const stage = event.stage;
	const mine =
		state.visible &&
		state.keyCode === event.keyCode &&
		state.captureId === event.captureId;
	if (stage._tag !== "recording")
		// DK hides the bar on any key's stage; only its own capture hides it here.
		return mine ? initialBar : state;
	const base: BarState = mine
		? state
		: {
				...initialBar,
				visible: true,
				keyCode: event.keyCode,
				captureId: event.captureId,
			};
	return {
		...base,
		text: isKnobVoiceKey(event.keyCode)
			? Option.none()
			: Option.some(
					recordingText(stage.status, stage.transcript, base.text, false),
				),
	};
}

export function reduceBarLevel(state: BarState, event: LevelEvent): BarState {
	if (
		!state.visible ||
		state.keyCode !== event.keyCode ||
		state.captureId !== event.captureId
	)
		return state;
	const rms = Number.isFinite(event.rms)
		? Math.max(0, Math.min(1, event.rms))
		: 0;
	return { ...state, rms, speaking: event.speaking };
}

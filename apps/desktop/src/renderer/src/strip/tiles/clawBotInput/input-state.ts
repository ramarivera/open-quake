import { Option } from "effect";
import type { StageEvent } from "../../../../../shared/voice-surface";
import type { StripStringKey } from "../../overlays/voice/strings";
import {
	applyFinal,
	emptyTranscript,
	type LiveTranscript,
	mergePartial,
} from "../clawBot/transcript-merge";

/** ClawBotInput's selection and voice buffer (QBI:371-554, AI-184, AI-187). */
export interface InputState {
	readonly keyCode: Option.Option<string>;
	readonly agentId: Option.Option<string>;
	readonly agentName: Option.Option<string>;
	readonly voice: LiveTranscript;
	/** Bumps whenever voice text should overwrite the box. */
	readonly revision: number;
}
export const initialInput: InputState = {
	keyCode: Option.none(),
	agentId: Option.none(),
	agentName: Option.none(),
	voice: emptyTranscript,
	revision: 0,
};

export const selectInput = (
	state: InputState,
	keyCode: string,
	agentId: Option.Option<string>,
	agentName: Option.Option<string>,
): InputState => ({
	...state,
	keyCode: Option.some(keyCode),
	agentId,
	agentName,
});

export function reduceInputStage(
	state: InputState,
	event: StageEvent,
): InputState {
	if (!Option.contains(state.keyCode, event.keyCode)) return state;
	const stage = event.stage;
	const write = (voice: LiveTranscript): InputState =>
		voice === state.voice
			? state
			: { ...state, voice, revision: state.revision + 1 };
	if (stage._tag === "recording") {
		// agentInfo sessionStart clears the box when the mic opens (QSV:1882-1890).
		if (stage.status === "listening" && stage.transcript === undefined)
			return state.voice.text === ""
				? state
				: { ...state, voice: emptyTranscript, revision: state.revision + 1 };
		return stage.transcript === undefined
			? state
			: write(mergePartial(state.voice, stage.transcript));
	}
	if (stage._tag === "processing" && stage.transcript !== undefined)
		return write(applyFinal(state.voice, stage.transcript));
	return state;
}

export type SendCheck =
	| {
			readonly _tag: "send";
			readonly keyCode: string;
			readonly agentId: string;
			readonly message: string;
	  }
	| { readonly _tag: "warn"; readonly key: StripStringKey }
	| { readonly _tag: "empty" };

/** QBI:527-554: needs a tapped clawbot key, then an agent, then text. */
export function checkSend(state: InputState, text: string): SendCheck {
	const message = text.trim();
	if (Option.isNone(state.keyCode))
		return {
			_tag: "warn",
			key: "quakeBotInputIconView.warnings.selectAssistantCard",
		};
	if (Option.isNone(state.agentId))
		return {
			_tag: "warn",
			key: "quakeBotInputIconView.warnings.selectAssistant",
		};
	if (message === "") return { _tag: "empty" };
	return {
		_tag: "send",
		keyCode: state.keyCode.value,
		agentId: state.agentId.value,
		message,
	};
}

/** S = clamp(h/440, 0.4, 2.0)·1.25 (QBI:464-486). */
export function inputScale(width: number, height: number): number {
	const base = width / height >= 1 ? height / 440 : width / 440;
	return Math.max(0.4, Math.min(2.0, base)) * 1.25;
}

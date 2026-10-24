import { Option } from "effect";
import type { TileStatus } from "../../../../../shared/voice-surface";
import type { StripStringKey } from "../../overlays/voice/strings";

/**
 * The AI Copilot view's status machine (ACV:818-1033, AI-192, AI-193). DK
 * keeps one per profile; every aiChat key and the knob feed it.
 */
export const COPILOT_TIMEOUT_MS = 330_000;

export type CopilotStatusText =
	| { readonly _tag: "string"; readonly key: StripStringKey }
	| { readonly _tag: "errorCode"; readonly code: string };

export interface CopilotState {
	readonly status: Option.Option<TileStatus>;
	/** DK keeps the last status text after a reset ("Completed" stays up). */
	readonly statusText: Option.Option<CopilotStatusText>;
	readonly activeKey: Option.Option<string>;
	readonly activeKeyType: Option.Option<string>;
	readonly activeKeyTitle: Option.Option<string>;
	/** −1 default, 0 up, 1 down (ACV currentActiveKeyCodeStatus). */
	readonly keyStatus: -1 | 0 | 1;
	readonly text: string;
	readonly statusSince: Option.Option<number>;
}
export const initialCopilot: CopilotState = {
	status: Option.none(),
	statusText: Option.none(),
	activeKey: Option.none(),
	activeKeyType: Option.none(),
	activeKeyTitle: Option.none(),
	keyStatus: -1,
	text: "",
	statusSince: Option.none(),
};

const STATUS_KEYS: Readonly<Record<TileStatus, StripStringKey>> = {
	[-1]: "aiIconViewTxt.status.error",
	0: "aiIconViewTxt.status.initializing",
	1: "aiIconViewTxt.status.processing",
	2: "aiIconViewTxt.status.completed",
	3: "aiIconViewTxt.status.startrecording",
	4: "aiIconViewTxt.status.generating",
	5: "aiIconViewTxt.status.systemBusy",
};
const statusText = (status: TileStatus): Option.Option<CopilotStatusText> =>
	Option.some({ _tag: "string", key: STATUS_KEYS[status] });

/** ACV setStatus with the 330 s watchdog's start time. */
function withStatus(
	state: CopilotState,
	status: Option.Option<TileStatus>,
	now: number,
): CopilotState {
	const wasIdle = Option.isNone(state.status);
	return {
		...state,
		status,
		statusSince: Option.isNone(status)
			? Option.none()
			: wasIdle
				? Option.some(now)
				: state.statusSince,
	};
}

/** ACV resetAIChatStatus: drop the active key; the status text stays. */
function reset(state: CopilotState): CopilotState {
	return {
		...state,
		status: Option.none(),
		statusSince: Option.none(),
		activeKey: Option.none(),
		activeKeyType: Option.none(),
		activeKeyTitle: Option.none(),
		keyStatus: state.keyStatus === 1 ? 1 : -1,
	};
}

export type CopilotEvent =
	| {
			readonly _tag: "keyDown";
			readonly keyCode: string;
			readonly keyType: string;
			readonly title: Option.Option<string>;
	  }
	| { readonly _tag: "keyUp"; readonly keyCode: string }
	| {
			readonly _tag: "response";
			readonly keyCode: Option.Option<string>;
			readonly status: TileStatus;
			readonly errorCode: Option.Option<string>;
			readonly message: Option.Option<string>;
	  }
	| { readonly _tag: "timeout" };

function append(state: CopilotState, message: string): CopilotState {
	if (message === "") return state;
	const separator =
		Option.contains(state.status, 2) &&
		state.text !== "" &&
		!state.text.endsWith("\n")
			? "\n"
			: "";
	return { ...state, text: state.text + separator + message };
}

export function reduceCopilot(
	state: CopilotState,
	event: CopilotEvent,
	now: number,
): CopilotState {
	switch (event._tag) {
		case "keyDown":
			if (Option.isNone(state.activeKey))
				return {
					...withStatus(state, Option.some(0), now),
					activeKey: Option.some(event.keyCode),
					activeKeyType: Option.some(event.keyType),
					activeKeyTitle: event.title,
					keyStatus: 1,
					statusText: statusText(0),
					text: "",
				};
			return Option.contains(state.activeKey, event.keyCode)
				? { ...state, keyStatus: 1 }
				: state;
		case "keyUp": {
			if (!Option.contains(state.activeKey, event.keyCode)) return state;
			if (state.keyStatus === 0) return state;
			const up = { ...state, keyStatus: 0 as const };
			const status = Option.getOrUndefined(state.status);
			if (status === 3)
				return {
					...withStatus(up, Option.some(1), now),
					statusText: statusText(1),
				};
			if (status === 0) return { ...reset(up), statusText: Option.none() };
			return reset(up);
		}
		case "timeout":
			if (Option.isNone(state.status)) return state;
			if (
				Option.match(state.statusSince, {
					onNone: () => true,
					onSome: (since) => now - since < COPILOT_TIMEOUT_MS,
				})
			)
				return state;
			return {
				...reset(state),
				statusText: Option.some({
					_tag: "string",
					key: "aiIconViewTxt.status.timeout",
				}),
			};
		case "response": {
			if (event.status === 3 && !Option.contains(state.status, 0)) return state;
			if (event.status === 2 && Option.isNone(event.keyCode))
				return Option.contains(state.status, 1)
					? { ...reset(state), statusText: Option.none() }
					: state;
			const foreign =
				Option.isSome(state.activeKey) &&
				!Option.exists(event.keyCode, (keyCode) =>
					Option.contains(state.activeKey, keyCode),
				);
			// DK resets the running turn when another key is rejected busy
			// (ACV:840-844); here only the toast reports that rejection.
			if (event.status === 5)
				return foreign ? state : { ...reset(state), statusText: statusText(5) };
			if (foreign) return state;
			const previous = Option.getOrUndefined(state.status);
			let next: CopilotState = {
				...withStatus(state, Option.some(event.status), now),
				statusText: statusText(event.status),
			};
			if (event.status === 2 && previous !== 2) {
				next =
					next.text !== "" && !next.text.endsWith("\n")
						? { ...next, text: `${next.text}\n` }
						: next;
				next = reset(next);
			}
			if (event.status === -1) {
				next = reset({
					...next,
					statusText: Option.match(event.errorCode, {
						onNone: () => statusText(-1),
						onSome: (code) => Option.some({ _tag: "errorCode", code }),
					}),
				});
			}
			return Option.match(event.message, {
				onNone: () => next,
				onSome: (message) => append(next, message),
			});
		}
	}
}

/** GlowEnergyOrb speed by status (ACV:267-290). */
export function orbSpeed(status: Option.Option<TileStatus>): number {
	switch (Option.getOrUndefined(status)) {
		case 0:
			return 3;
		case 1:
			return 10;
		case 3:
		case 4:
			return 6;
		default:
			return 1;
	}
}

/** Idle on the strip with no status text (ACV:462-467). */
export const showsPushToTalkHint = (state: CopilotState): boolean =>
	Option.isNone(state.status) && Option.isNone(state.statusText);
/** Processing with no text yet (ACV:468-477). */
export const showsCancelHint = (state: CopilotState): boolean =>
	Option.contains(state.status, 1) && state.text.trim() === "";

/** ACV recalculateLayout at the tile's size. */
export function copilotLayout(width: number, height: number) {
	const base = Math.min(width, height);
	const gap = Math.max(4, Math.min(20, base * 0.015));
	const textFs = Math.max(10, Math.min(20, base * 0.05));
	const smallFs = Math.max(8, Math.min(16, base * 0.035));
	const toolbar = height * 0.2;
	const content = height - toolbar;
	const left = width / 5;
	const right = (width * 4) / 5;
	let orbWidth = left - gap * 2;
	let orbHeight = orbWidth * 2;
	if (orbHeight > content - gap * 2) {
		orbHeight = content - gap * 2;
		orbWidth = orbHeight / 2;
	}
	return {
		gap,
		textFs,
		smallFs,
		toolbar,
		content,
		left,
		right,
		orbWidth,
		orbHeight,
		rootBorder: Math.max(0.5, Math.min(2, gap * 0.15)),
		toolbarBorder: Math.max(1, Math.min(3, gap * 0.2)),
		panelShadow: Math.max(4, Math.min(12, gap * 1.2)),
	};
}

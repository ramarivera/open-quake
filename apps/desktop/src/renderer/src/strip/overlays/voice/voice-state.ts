import { Option } from "effect";
import {
	isKnobVoiceKey,
	type KeyAlertKind,
	type ToastKey,
	tileStatusFor,
	type VoiceSurfaceEvent,
} from "../../../../../shared/voice-surface";
import {
	COPILOT_TIMEOUT_MS,
	type CopilotEvent,
	type CopilotState,
	initialCopilot,
	reduceCopilot,
} from "../../tiles/aiCopilot/copilot-state";
import {
	agentFrom,
	type ConversationState,
	initialConversation,
	reduceConversation,
} from "../../tiles/clawBot/conversation";
import {
	type InputState,
	initialInput,
	reduceInputStage,
	selectInput,
} from "../../tiles/clawBotInput/input-state";
import {
	type BarState,
	expireOverlay,
	initialBar,
	initialOverlay,
	type OverlayState,
	reduceBarLevel,
	reduceBarStage,
	reduceOverlay,
	tickCountdown,
} from "./overlay-state";

/**
 * Everything the strip shows for voice and chat, reduced from main's
 * `VoiceSurfaceEvent`s. Routing follows design.md "Tile routing".
 */
export const ALERT_INVALID_MS = 2000;
export const TOAST_MS = 3000;

export interface KeyInfo {
	readonly type: string;
	readonly title: Option.Option<string>;
	readonly agentId: Option.Option<string>;
	readonly voiceInput?: boolean;
}
export interface StripToast {
	readonly id: number;
	readonly key: ToastKey | "clipboard.copySuccess" | "clipboard.copyFailed";
	readonly name: Option.Option<string>;
	readonly at: number;
}
export interface VoiceView {
	readonly overlay: OverlayState;
	readonly bar: BarState;
	readonly copilot: CopilotState;
	readonly conversation: ConversationState;
	readonly input: InputState;
	readonly alerts: ReadonlyMap<
		string,
		{ readonly alert: KeyAlertKind; readonly at: number }
	>;
	readonly toasts: readonly StripToast[];
	/** The last selected clawbot key: its green dot (SCREEN-040). */
	readonly activeClawbot: Option.Option<string>;
	readonly nextToast: number;
}
export const initialVoiceView: VoiceView = {
	overlay: initialOverlay,
	bar: initialBar,
	copilot: initialCopilot,
	conversation: initialConversation,
	input: initialInput,
	alerts: new Map(),
	toasts: [],
	activeClawbot: Option.none(),
	nextToast: 1,
};

export type VoiceAction =
	| { readonly _tag: "event"; readonly event: VoiceSurfaceEvent }
	| { readonly _tag: "countdown" }
	| { readonly _tag: "expire" }
	| { readonly _tag: "profileReset" }
	| { readonly _tag: "toast"; readonly key: StripToast["key"] };

const copilot = (
	view: VoiceView,
	event: CopilotEvent,
	now: number,
): VoiceView => ({ ...view, copilot: reduceCopilot(view.copilot, event, now) });

function routeEvent(
	view: VoiceView,
	event: VoiceSurfaceEvent,
	keys: ReadonlyMap<string, KeyInfo>,
	now: number,
): VoiceView {
	const typeOf = (keyCode: string): string =>
		isKnobVoiceKey(keyCode) ? "knob" : (keys.get(keyCode)?.type ?? "");
	const toConversation = (keyCode: string): boolean =>
		typeOf(keyCode) === "clawbot" || typeOf(keyCode) === "knob";
	switch (event._tag) {
		case "Reset": {
			const reset = reduceVoice(view, { _tag: "profileReset" }, keys, now);
			return {
				...reset,
				overlay: initialOverlay,
				alerts: new Map(),
				toasts: [],
			};
		}
		case "Stage": {
			let next: VoiceView = { ...view, bar: reduceBarStage(view.bar, event) };
			if (isKnobVoiceKey(event.keyCode))
				next = { ...next, overlay: reduceOverlay(next.overlay, event, now) };
			// Grid stages remap to tile statuses (QSV:1837-1929).
			else
				next = Option.match(tileStatusFor(event.stage), {
					onNone: () => next,
					onSome: (status) =>
						copilot(
							next,
							{
								_tag: "response",
								keyCode: Option.some(event.keyCode),
								status,
								errorCode:
									event.stage._tag === "failed"
										? Option.fromNullable(event.stage.errorCode)
										: Option.none(),
								message:
									event.stage._tag === "failed"
										? Option.fromNullable(event.stage.message)
										: Option.none(),
							},
							now,
						),
				});
			if (toConversation(event.keyCode))
				next = {
					...next,
					conversation: reduceConversation(next.conversation, event, now),
				};
			if (typeOf(event.keyCode) === "clawbot")
				next = { ...next, input: reduceInputStage(next.input, event) };
			return next;
		}
		case "Level":
			return { ...view, bar: reduceBarLevel(view.bar, event) };
		case "KeyPress": {
			const info = keys.get(event.keyCode);
			const type = info?.type ?? "";
			if (event.action === "up")
				return info?.voiceInput === false
					? view
					: copilot(view, { _tag: "keyUp", keyCode: event.keyCode }, now);
			let next =
				info?.voiceInput === false
					? view
					: copilot(
							view,
							{
								_tag: "keyDown",
								keyCode: event.keyCode,
								keyType: type,
								title: info?.title ?? Option.none(),
							},
							now,
						);
			if (type === "clawbot") {
				const agentId = Option.orElse(info?.agentId ?? Option.none(), () =>
					Option.some("default"),
				);
				const name = info?.title ?? Option.none();
				next = {
					...next,
					activeClawbot: Option.some(event.keyCode),
					conversation: reduceConversation(
						next.conversation,
						{
							_tag: "Select",
							keyCode: event.keyCode,
							agent: agentFrom({
								id: Option.getOrElse(agentId, () => "default"),
								name: Option.getOrElse(name, () => ""),
							}),
						},
						now,
					),
					input: selectInput(next.input, event.keyCode, agentId, name),
				};
			}
			return next;
		}
		case "TurnStarted":
			return toConversation(event.keyCode)
				? {
						...view,
						conversation: reduceConversation(view.conversation, event, now),
					}
				: view;
		case "Chunk": {
			const chunk = event.chunk;
			const response: CopilotEvent =
				chunk.type === "answer"
					? {
							_tag: "response",
							keyCode: Option.some(event.keyCode),
							status: 1,
							errorCode: Option.none(),
							message: Option.some(chunk.textDelta),
						}
					: chunk.type === "end" && chunk.outcome === "completed"
						? {
								_tag: "response",
								keyCode: Option.some(event.keyCode),
								status: 2,
								errorCode: Option.none(),
								message: Option.none(),
							}
						: {
								_tag: "response",
								keyCode: Option.some(event.keyCode),
								status: chunk.type === "end" ? -1 : 1,
								errorCode:
									chunk.type === "end"
										? Option.fromNullable(chunk.errorCode)
										: Option.none(),
								message: Option.none(),
							};
			const next =
				chunk.type === "followUp" ? view : copilot(view, response, now);
			return toConversation(event.keyCode)
				? {
						...next,
						conversation: reduceConversation(next.conversation, event, now),
					}
				: next;
		}
		case "Tool":
		case "AgentStatus":
			return {
				...view,
				conversation: reduceConversation(view.conversation, event, now),
			};
		case "KeyAlert": {
			const alerts = new Map(view.alerts);
			alerts.set(event.keyCode, { alert: event.alert, at: now });
			return { ...view, alerts };
		}
		case "Toast":
			return {
				...view,
				nextToast: view.nextToast + 1,
				toasts: [
					...view.toasts,
					{
						id: view.nextToast,
						key: event.messageKey,
						name: Option.fromNullable(event.name),
						at: now,
					},
				].slice(-3),
			};
		case "MeetingStage":
			return view;
	}
}

export function reduceVoice(
	view: VoiceView,
	action: VoiceAction,
	keys: ReadonlyMap<string, KeyInfo>,
	now: number,
): VoiceView {
	switch (action._tag) {
		case "event":
			return routeEvent(view, action.event, keys, now);
		case "countdown":
			return { ...view, overlay: tickCountdown(view.overlay) };
		case "toast":
			return {
				...view,
				nextToast: view.nextToast + 1,
				toasts: [
					...view.toasts,
					{ id: view.nextToast, key: action.key, name: Option.none(), at: now },
				].slice(-3),
			};
		case "profileReset":
			// aiChatView:profileChanged (AI-170): the active key, live row and cancel indicator go.
			return {
				...view,
				copilot: { ...initialCopilot, text: view.copilot.text },
				conversation: reduceConversation(
					view.conversation,
					{ _tag: "ProfileReset" },
					now,
				),
				input: { ...initialInput, revision: view.input.revision + 1 },
				activeClawbot: Option.none(),
				bar: initialBar,
			};
		case "expire": {
			const alerts = new Map(
				[...view.alerts].filter(
					([, { alert, at }]) =>
						alert !== "invalid" || now - at < ALERT_INVALID_MS,
				),
			);
			return {
				...view,
				overlay: expireOverlay(view.overlay, now),
				alerts: alerts.size === view.alerts.size ? view.alerts : alerts,
				toasts: view.toasts.filter((toast) => now - toast.at < TOAST_MS),
				copilot: reduceCopilot(view.copilot, { _tag: "timeout" }, now),
			};
		}
	}
}

/** The next time an alert, toast or the copilot watchdog expires. */
export function nextExpiry(view: VoiceView): Option.Option<number> {
	const times = [
		...Option.toArray(view.overlay.busyUntil),
		...[...view.alerts.values()]
			.filter(({ alert }) => alert === "invalid")
			.map(({ at }) => at + ALERT_INVALID_MS),
		...view.toasts.map((toast) => toast.at + TOAST_MS),
		...Option.toArray(
			Option.map(
				view.copilot.statusSince,
				(since) => since + COPILOT_TIMEOUT_MS,
			),
		),
	];
	return times.length === 0 ? Option.none() : Option.some(Math.min(...times));
}

/** The key showing the AI cancel indicator: the active key while processing. */
export const cancelIndicatorKey = (view: VoiceView): Option.Option<string> =>
	Option.contains(view.copilot.status, 1)
		? view.copilot.activeKey
		: Option.none();

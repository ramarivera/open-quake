import {
	emptyTurn,
	reduceChunk,
	type TurnView,
} from "@open-quake/edge/chat/reducers";
import { Option } from "effect";
import type {
	AgentConnection,
	AgentRef,
	StageEvent,
	VoiceSurfaceEvent,
} from "../../../../../shared/voice-surface";
import type { StripStringKey } from "../../overlays/voice/strings";
import { type ErrorCopy, errorCopy, isHintCopy } from "./error-copy";
import {
	applyFinal,
	emptyTranscript,
	type LiveTranscript,
	mergePartial,
} from "./transcript-merge";

/**
 * ClawBotView's conversation (QBV, AI-157–AI-170): one group per turn,
 * live voice row, System hints. Answers are ai-chat-core TurnViews.
 */
export const HINT_DEDUPE_MS = 5000;
const GROUP_LIMIT = 100;

export type ChatText =
	| { readonly _tag: "literal"; readonly text: string }
	| { readonly _tag: "copy"; readonly copy: ErrorCopy };
export interface ChatAgent {
	readonly id: string;
	readonly name: string;
	/** Gradient type 0–4 (AI-158). */
	readonly icon: number;
}
export type ChatMessage =
	| {
			readonly _tag: "text";
			readonly id: string;
			readonly text: ChatText;
			readonly isVoice: boolean;
			readonly ts: number;
	  }
	| {
			readonly _tag: "answer";
			readonly id: string;
			readonly view: TurnView;
			readonly ts: number;
	  }
	| {
			readonly _tag: "tool";
			readonly id: string;
			readonly toolCallId: string;
			readonly name: string;
			readonly phase: "start" | "result" | "error";
			readonly args: Option.Option<string>;
			readonly output: Option.Option<string>;
			readonly ts: number;
	  };
export interface ChatGroup {
	readonly id: string;
	readonly kind: "agent" | "system" | "user";
	readonly agent: ChatAgent;
	readonly turnId: Option.Option<string>;
	readonly ts: number;
	readonly messages: readonly ChatMessage[];
}
export interface LiveRow {
	readonly transcript: LiveTranscript;
	readonly ts: number;
	readonly agentName: Option.Option<string>;
}
export interface ConversationState {
	readonly groups: readonly ChatGroup[];
	readonly live: Option.Option<LiveRow>;
	readonly activeKey: Option.Option<string>;
	readonly activeAgent: Option.Option<ChatAgent>;
	/** Voice ownership survives selecting a different assistant for typed input. */
	readonly capture: Option.Option<{
		readonly keyCode: string;
		readonly captureId: string;
		readonly agent: Option.Option<ChatAgent>;
	}>;
	readonly connection: AgentConnection;
	readonly nextId: number;
}
export const initialConversation: ConversationState = {
	groups: [],
	live: Option.none(),
	activeKey: Option.none(),
	activeAgent: Option.none(),
	capture: Option.none(),
	connection: "checking",
	nextId: 1,
};

/** `0-1`-style DK resource ids; the last number picks the gradient. */
export function agentFrom(ref: AgentRef | undefined): ChatAgent {
	const icon = Number(ref?.icon?.split("-").at(-1) ?? 0);
	return {
		id: ref?.id ?? "default",
		name: ref?.name ?? "",
		icon: Number.isInteger(icon) && icon >= 0 ? icon % 5 : 0,
	};
}
const SYSTEM_AGENT: ChatAgent = { id: "system", name: "", icon: 0 };

function push(state: ConversationState, group: ChatGroup): ConversationState {
	return { ...state, groups: [...state.groups, group].slice(-GROUP_LIMIT) };
}
const sameText = (a: ChatText, b: ChatText): boolean =>
	a._tag === "literal"
		? b._tag === "literal" && a.text === b.text
		: b._tag === "copy" &&
			(a.copy._tag === "string"
				? b.copy._tag === "string" && a.copy.key === b.copy.key
				: b.copy._tag === "errorCode" && a.copy.code === b.copy.code);

/** Same text within 5000 ms of the last hint is dropped (AI-168). */
export function appendHint(
	state: ConversationState,
	text: ChatText,
	now: number,
): ConversationState {
	const last = state.groups.at(-1);
	const lastMessage = last?.messages.at(-1);
	if (
		last?.kind === "system" &&
		lastMessage?._tag === "text" &&
		sameText(lastMessage.text, text) &&
		now - last.ts < HINT_DEDUPE_MS
	)
		return state;
	const id = `hint-${state.nextId}`;
	return push(
		{ ...state, nextId: state.nextId + 1 },
		{
			id,
			kind: "system",
			agent: SYSTEM_AGENT,
			turnId: Option.none(),
			ts: now,
			messages: [
				{ _tag: "text", id: `${id}-m`, text, isVoice: false, ts: now },
			],
		},
	);
}

const CONNECTION_HINTS: Readonly<
	Record<AgentConnection, StripStringKey | undefined>
> = {
	checking: undefined,
	noService: "quakeBotIconView.statusHintNoService",
	connecting: "quakeBotIconView.statusHintConnecting",
	connected: "quakeBotIconView.statusHintConnected",
	disconnected: "quakeBotIconView.statusHintDisconnected",
};

/** An error on a turn: a System hint for hint codes, else an agent bubble. */
function appendError(
	state: ConversationState,
	text: ChatText,
	now: number,
): ConversationState {
	if (text._tag === "copy" && isHintCopy(text.copy))
		return appendHint(state, text, now);
	const id = `err-${state.nextId}`;
	return push(
		{ ...state, nextId: state.nextId + 1 },
		{
			id,
			kind: "agent",
			agent: Option.getOrElse(state.activeAgent, () => agentFrom(undefined)),
			turnId: Option.none(),
			ts: now,
			messages: [
				{ _tag: "text", id: `${id}-m`, text, isVoice: false, ts: now },
			],
		},
	);
}

const keyMatches = (state: ConversationState, event: StageEvent): boolean =>
	Option.match(state.capture, {
		onNone: () =>
			event.keyCode === "0,1" ||
			Option.isNone(state.activeKey) ||
			Option.contains(state.activeKey, event.keyCode),
		onSome: (capture) =>
			capture.keyCode === event.keyCode &&
			capture.captureId === event.captureId,
	});

function updateTurn(
	state: ConversationState,
	turnId: string,
	update: (messages: readonly ChatMessage[]) => readonly ChatMessage[],
): ConversationState {
	let found = false;
	const groups = state.groups.map((group) => {
		if (found || !Option.contains(group.turnId, turnId)) return group;
		found = true;
		return { ...group, messages: update(group.messages) };
	});
	return found ? { ...state, groups } : state;
}

/** Live transcript and errors from a clawbot or knob capture (AI-164, AI-166). */
function reduceStage(
	state: ConversationState,
	event: StageEvent,
	now: number,
): ConversationState {
	const stage = event.stage;
	const capture = Option.getOrElse(state.capture, () => ({
		keyCode: event.keyCode,
		captureId: event.captureId,
		agent: Option.contains(state.activeKey, event.keyCode)
			? state.activeAgent
			: Option.none(),
	}));
	const agentName = Option.map(capture.agent, (agent) => agent.name);
	const live = Option.getOrElse(
		Option.map(state.live, (row) => row.transcript),
		() => emptyTranscript,
	);
	const withLive = (transcript: LiveTranscript): ConversationState =>
		transcript.text === ""
			? state
			: {
					...state,
					capture: Option.some(capture),
					live: Option.some({ transcript, ts: now, agentName }),
				};
	switch (stage._tag) {
		case "recording":
			return stage.transcript === undefined
				? { ...state, capture: Option.some(capture) }
				: withLive(mergePartial(live, stage.transcript));
		case "processing":
			return stage.transcript === undefined
				? state
				: withLive(applyFinal(live, stage.transcript));
		case "failed": {
			const text: ChatText =
				stage.message !== undefined && stage.message.trim() !== ""
					? { _tag: "literal", text: stage.message.trim() }
					: {
							_tag: "copy",
							copy:
								stage.errorCode === undefined
									? { _tag: "string", key: "aiAudio.error" }
									: errorCopy(stage.errorCode),
						};
			return appendError(
				{ ...state, live: Option.none(), capture: Option.none() },
				text,
				now,
			);
		}
		case "busy":
		case "idle":
			return { ...state, live: Option.none(), capture: Option.none() };
	}
}

export type ConversationEvent =
	| VoiceSurfaceEvent
	| {
			readonly _tag: "Select";
			readonly keyCode: string;
			readonly agent: ChatAgent;
	  }
	| { readonly _tag: "ProfileReset" };

export function reduceConversation(
	state: ConversationState,
	event: ConversationEvent,
	now: number,
): ConversationState {
	switch (event._tag) {
		case "Select":
			return {
				...state,
				activeKey: Option.some(event.keyCode),
				activeAgent: Option.some(event.agent),
			};
		case "ProfileReset":
			// aiChatView:profileChanged (QBV:1594-1607, AI-170).
			return {
				...state,
				live: Option.none(),
				activeKey: Option.none(),
				activeAgent: Option.none(),
				capture: Option.none(),
			};
		case "AgentStatus": {
			if (event.state === state.connection) return state;
			const key = CONNECTION_HINTS[event.state];
			const next = { ...state, connection: event.state };
			return key === undefined
				? next
				: appendHint(
						next,
						{ _tag: "copy", copy: { _tag: "string", key } },
						now,
					);
		}
		case "Stage":
			return keyMatches(state, event) ? reduceStage(state, event, now) : state;
		case "TurnStarted": {
			const ownsCapture =
				event.source === "voice" &&
				Option.exists(
					state.capture,
					(capture) => capture.keyCode === event.keyCode,
				);
			const ownerAgent = ownsCapture
				? Option.flatMap(state.capture, (capture) => capture.agent)
				: Option.contains(state.activeKey, event.keyCode)
					? state.activeAgent
					: Option.none();
			const agent = event.agent
				? agentFrom(event.agent)
				: Option.getOrElse(ownerAgent, () => agentFrom(undefined));
			let next = state;
			if (event.source === "typed") {
				// aiChatView:userOutgoingMessage (QBV:1612-1661, AI-165).
				const id = `user-${next.nextId}`;
				next = push(
					{ ...next, nextId: next.nextId + 1 },
					{
						id,
						kind: "user",
						agent,
						turnId: Option.none(),
						ts: now,
						messages: [
							{
								_tag: "text",
								id: `${id}-m`,
								text: { _tag: "literal", text: event.prompt },
								isVoice: false,
								ts: now,
							},
						],
					},
				);
			}
			const id = `turn-${next.nextId}`;
			// The live row moves into the agent's group as a voice message (QBV:1857-1869).
			const voice: ChatMessage[] =
				event.source === "voice"
					? [
							{
								_tag: "text",
								id: `${id}-voice`,
								text: {
									_tag: "literal",
									text: event.prompt,
								},
								isVoice: true,
								ts: now,
							},
						]
					: [];
			return push(
				{
					...next,
					nextId: next.nextId + 1,
					...(ownsCapture
						? { live: Option.none(), capture: Option.none() }
						: {}),
				},
				{
					id,
					kind: "agent",
					agent,
					turnId: Option.some(event.turnId),
					ts: now,
					messages: [
						...voice,
						{
							_tag: "answer",
							id: `${id}-answer`,
							view: emptyTurn(event.sessionId, event.turnId),
							ts: now,
						},
					],
				},
			);
		}
		case "Chunk": {
			const chunk = event.chunk;
			const next = updateTurn(state, chunk.turnId, (messages) => {
				const answer = messages.find((message) => message._tag === "answer");
				if (answer?._tag !== "answer") return messages;
				const view = reduceChunk(answer.view, chunk);
				const resumed =
					chunk.type === "answer" && view.text !== answer.view.text;
				return messages.map((message) =>
					message === answer
						? { ...answer, view }
						: message._tag === "tool" && message.phase === "start" && resumed
							? { ...message, phase: "result" }
							: message,
				);
			});
			if (chunk.type !== "end" || chunk.outcome === "completed") return next;
			const code =
				chunk.errorCode ??
				(chunk.outcome === "cancelled"
					? "CHAT.TURN.CANCELLED"
					: chunk.outcome === "timedOut"
						? "CHAT.RESPONSE.TIMEOUT"
						: "2012");
			return appendError(next, { _tag: "copy", copy: errorCopy(code) }, now);
		}
		case "Tool": {
			const tool: ChatMessage = {
				_tag: "tool",
				id: `tool-${event.toolCallId}`,
				toolCallId: event.toolCallId,
				name: event.name,
				phase: event.phase,
				args: Option.fromNullable(event.args),
				output: Option.fromNullable(event.output),
				ts: now,
			};
			// Upsert by toolCallId (AI-178); a later answer delta keeps its place.
			return updateTurn(state, event.turnId, (messages) =>
				messages.some(
					(message) =>
						message._tag === "tool" && message.toolCallId === event.toolCallId,
				)
					? messages.map((message) =>
							message._tag === "tool" && message.toolCallId === event.toolCallId
								? {
										...tool,
										ts: message.ts,
										args: Option.orElse(tool.args, () => message.args),
									}
								: message,
						)
					: [
							...messages.filter((message) => message._tag !== "answer"),
							tool,
							...messages.filter((message) => message._tag === "answer"),
						],
			);
		}
		default:
			return state;
	}
}

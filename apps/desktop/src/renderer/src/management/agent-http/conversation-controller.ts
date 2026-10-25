import type { RuntimeConversationEvent } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import { RuntimeErrors } from "../../../../../../../packages/edge/src/agent-http/runtime-errors";
import type {
	AgentConversationsBridge,
	ConversationEvent,
	ConversationHistory,
	ConversationScope,
} from "../../../../shared/agent-conversations";
import t from "./strings.json";

type ToolEvent = Extract<RuntimeConversationEvent, { readonly _tag: "tool" }>;
type UsageEvent = Extract<RuntimeConversationEvent, { readonly _tag: "usage" }>;
type Outcome = "completed" | "cancelled" | "failed";
export interface ConversationState {
	readonly history: readonly ConversationHistory[];
	readonly sessionId: string | undefined;
	readonly active:
		| { readonly requestId: string; readonly lastSeq: number }
		| undefined;
	readonly pending:
		| "history"
		| "starting"
		| "cancelling"
		| "clearing"
		| undefined;
	readonly status: string;
	readonly error:
		| { readonly code: string; readonly message: string }
		| undefined;
	readonly tools: readonly ToolEvent[];
	readonly usage: UsageEvent["usage"] | undefined;
}

/** Session and request identities prevent late replies from crossing conversation scopes. */
export function createConversationController(
	bridge: AgentConversationsBridge | undefined,
	scope: Pick<ConversationScope, "connectionId" | "agentId">,
	requestId: () => string = () => crypto.randomUUID(),
) {
	let state: ConversationState = {
		history: [],
		sessionId: undefined,
		active: undefined,
		pending: undefined,
		status: "",
		error: undefined,
		tools: [],
		usage: undefined,
	};
	let epoch = 0;
	let turnGeneration = 0;
	let mounted = false;
	let off: (() => void) | undefined;
	const listeners = new Set<() => void>();
	const update = (next: ConversationState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	const failure = () => ({
		code: RuntimeErrors.RuntimeRequestFailed.code,
		message: t.disconnected,
	});
	const finish = (outcome: Outcome) => {
		const id = state.active?.requestId;
		update({
			...state,
			active: undefined,
			pending: undefined,
			status: t[outcome],
			history: state.history.map((session) =>
				session.sessionId === state.sessionId
					? {
							...session,
							turns: session.turns.map((turn) =>
								turn.requestId === id ? { ...turn, outcome } : turn,
							),
						}
					: session,
			),
		});
	};
	const receive = (event: ConversationEvent) => {
		if (
			!mounted ||
			!state.active ||
			event.requestId !== state.active.requestId ||
			event.connectionId !== scope.connectionId ||
			event.agentId !== scope.agentId ||
			event.sessionId !== state.sessionId ||
			event.seq <= state.active.lastSeq
		)
			return;
		update({ ...state, active: { ...state.active, lastSeq: event.seq } });
		if (event.type === "end") {
			if (event.outcome === "failed")
				update({
					...state,
					error: {
						code: event.errorCode ?? RuntimeErrors.RuntimeRequestFailed.code,
						message: event.message ?? t.failed,
					},
				});
			finish(event.outcome);
			return;
		}
		const provider = event.event;
		switch (provider._tag) {
			case "textDelta":
				update({
					...state,
					status: t.streaming,
					history: state.history.map((session) =>
						session.sessionId === event.sessionId
							? {
									...session,
									turns: session.turns.map((turn) =>
										turn.requestId === event.requestId
											? { ...turn, answer: turn.answer + provider.textDelta }
											: turn,
									),
								}
							: session,
					),
				});
				break;
			case "status":
				update({ ...state, status: provider.text });
				break;
			case "tool":
				update({
					...state,
					tools: [
						...state.tools.filter(
							(tool) => tool.toolCallId !== provider.toolCallId,
						),
						provider,
					],
				});
				break;
			case "usage":
				update({ ...state, usage: provider.usage });
				break;
			// A provider completion still needs the service's terminal outcome.
			case "completed":
				break;
		}
	};
	const refresh = async () => {
		if (!mounted || state.active || state.pending) return;
		if (!bridge) {
			update({
				...state,
				error: {
					code: RuntimeErrors.RuntimeUnavailable.code,
					message: t.historyUnavailable,
				},
			});
			return;
		}
		const requestEpoch = epoch;
		update({ ...state, pending: "history", error: undefined });
		try {
			const reply = await bridge.request({ type: "history", ...scope });
			if (!mounted || requestEpoch !== epoch) return;
			if (reply._tag === "rejected") update({ ...state, error: reply });
			else
				update({
					...state,
					history: reply.history.filter(
						(session) =>
							session.connectionId === scope.connectionId &&
							session.agentId === scope.agentId,
					),
					sessionId: reply.history.some(
						(session) =>
							session.sessionId === state.sessionId &&
							session.connectionId === scope.connectionId &&
							session.agentId === scope.agentId,
					)
						? state.sessionId
						: undefined,
				});
		} catch {
			if (mounted && requestEpoch === epoch)
				update({ ...state, error: failure() });
		} finally {
			if (mounted && requestEpoch === epoch)
				update({ ...state, pending: undefined });
		}
	};
	const send = async (text: string): Promise<boolean> => {
		if (
			!mounted ||
			!bridge ||
			state.active ||
			state.pending ||
			!text.trim() ||
			text.length > 32768
		)
			return false;
		const requestEpoch = epoch;
		const id = requestId();
		const generation = ++turnGeneration;
		const previousSessionId = state.sessionId;
		const sessionId = previousSessionId ?? id;
		const session = state.history.find(
			(item) => item.sessionId === sessionId,
		) ?? { ...scope, sessionId, turns: [] };
		const previousHistory = state.history;
		update({
			...state,
			sessionId,
			pending: "starting",
			active: { requestId: id, lastSeq: -1 },
			error: undefined,
			status: t.waiting,
			tools: [],
			usage: undefined,
			history: [
				...state.history.filter((item) => item.sessionId !== sessionId),
				{
					...session,
					turns: [
						...session.turns,
						{ requestId: id, text, answer: "", outcome: "processing" },
					],
				},
			],
		});
		try {
			const reply = await bridge.request({
				type: "start",
				...scope,
				...(previousSessionId === undefined
					? {}
					: { sessionId: previousSessionId }),
				requestId: id,
				text,
			});
			if (!mounted || requestEpoch !== epoch || generation !== turnGeneration)
				return false;
			if (reply._tag === "rejected") {
				update({
					...state,
					error: reply,
					active: undefined,
					pending: undefined,
					history: previousHistory,
					sessionId: previousSessionId,
					status: t.failed,
				});
				return false;
			}
			update({
				...state,
				pending: state.pending === "starting" ? undefined : state.pending,
			});
			return true;
		} catch {
			if (mounted && requestEpoch === epoch && generation === turnGeneration) {
				update({ ...state, error: failure() });
				finish("failed");
				// The request may have reached main before IPC disconnected.
				void bridge
					.request({ type: "cancel", requestId: id })
					.catch(() => undefined);
			}
			return false;
		}
	};
	const cancel = async () => {
		const active = state.active;
		if (!mounted || !bridge || !active || state.pending === "cancelling")
			return;
		const requestEpoch = epoch;
		update({ ...state, pending: "cancelling", error: undefined });
		try {
			const reply = await bridge.request({
				type: "cancel",
				requestId: active.requestId,
			});
			if (
				!mounted ||
				requestEpoch !== epoch ||
				state.active?.requestId !== active.requestId
			)
				return;
			if (reply._tag === "rejected")
				update({ ...state, pending: undefined, error: reply });
			else finish("cancelled");
		} catch {
			if (mounted && requestEpoch === epoch)
				update({ ...state, pending: undefined, error: failure() });
		}
	};
	const clear = async () => {
		if (
			!mounted ||
			!bridge ||
			!state.sessionId ||
			state.active ||
			state.pending
		)
			return;
		const requestEpoch = epoch;
		const sessionId = state.sessionId;
		update({ ...state, pending: "clearing", error: undefined });
		try {
			const reply = await bridge.request({
				type: "clear",
				...scope,
				sessionId,
			});
			if (!mounted || requestEpoch !== epoch) return;
			if (reply._tag === "rejected") update({ ...state, error: reply });
			else
				update({
					...state,
					history: state.history.filter(
						(session) => session.sessionId !== sessionId,
					),
					sessionId: undefined,
					tools: [],
					usage: undefined,
					status: "",
				});
		} catch {
			if (mounted && requestEpoch === epoch)
				update({ ...state, error: failure() });
		} finally {
			if (mounted && requestEpoch === epoch)
				update({ ...state, pending: undefined });
		}
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		send,
		cancel,
		clear,
		refresh,
		dismissError: () => update({ ...state, error: undefined }),
		selectSession: (sessionId: string | undefined) => {
			if (
				state.active ||
				state.pending ||
				(sessionId !== undefined &&
					!state.history.some((item) => item.sessionId === sessionId))
			)
				return;
			update({
				...state,
				sessionId,
				error: undefined,
				status: "",
				tools: [],
				usage: undefined,
			});
		},
		start: () => {
			mounted = true;
			epoch++;
			update({ ...state, active: undefined, pending: undefined });
			off = bridge?.onEvent(receive);
			void refresh();
		},
		dispose: () => {
			mounted = false;
			epoch++;
			if (bridge && state.active)
				void bridge
					.request({ type: "cancel", requestId: state.active.requestId })
					.catch(() => undefined);
			off?.();
			off = undefined;
		},
	};
}

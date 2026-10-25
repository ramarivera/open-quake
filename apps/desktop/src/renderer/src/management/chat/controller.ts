import { Option, Schema } from "effect";
import {
	SessionId,
	TurnId,
	type TurnSnapshot,
} from "../../../../../../../packages/edge/src/chat/chat-contracts";
import {
	emptyTurn,
	reduceChunk,
	restoreSnapshot,
	type TurnView,
} from "../../../../../../../packages/edge/src/chat/chat-invariants";
import type { PublicChatHistory } from "../../../../../../../packages/edge/src/chat/chat-rpc";
import type { DirectChatBridge } from "../../../../shared/chat";
export interface ChatView {
	readonly sessionId: SessionId;
	readonly histories: readonly PublicChatHistory[];
	readonly current: PublicChatHistory | undefined;
	readonly turn: TurnView | undefined;
	readonly input: string;
	readonly pending: boolean;
	readonly loading: boolean;
	readonly error: string;
}
const codeOf = (cause: unknown) =>
	typeof cause === "object" &&
	cause !== null &&
	"code" in cause &&
	typeof cause.code === "string" &&
	/^(AI|CHAT)\.[A-Z._]+$/.test(cause.code)
		? cause.code
		: "CHAT.TRANSPORT.UNAVAILABLE";
export function createChatController(bridge: DirectChatBridge | undefined) {
	let state: ChatView = {
		sessionId: Schema.decodeUnknownSync(SessionId)(crypto.randomUUID()),
		histories: [],
		current: undefined,
		turn: undefined,
		input: "",
		pending: false,
		loading: true,
		error: "",
	};
	let off: (() => void) | undefined;
	let disposed = false,
		epoch = 0,
		subscriptionEpoch = 0,
		refreshEpoch = 0;
	const listeners = new Set<() => void>();
	const set = (change: Partial<ChatView>) => {
		if (!disposed) {
			state = { ...state, ...change };
			for (const listener of listeners) listener();
		}
	};
	const fail = (cause: unknown) =>
		set({ pending: false, loading: false, error: codeOf(cause) });
	const refresh = async () => {
		if (!bridge)
			return set({ loading: false, error: "CHAT.BRIDGE.UNAVAILABLE" });
		const generation = epoch,
			refresh = ++refreshEpoch;
		try {
			const histories = await bridge.list();
			if (generation !== epoch || refresh !== refreshEpoch) return;
			const current = histories.find(
				(item) => item.sessionId === state.sessionId,
			);
			set({ histories, current, loading: false });
			const active = current?.turns.at(-1);
			if (active?.status === "processing" && !state.turn) {
				set({ pending: true, input: active.input });
				attach(active.snapshot);
			}
		} catch (cause) {
			if (generation === epoch && refresh === refreshEpoch)
				set({ loading: false, error: codeOf(cause) });
		}
	};
	const attach = (snapshot: TurnSnapshot) => {
		if (!bridge || disposed) return;
		off?.();
		const generation = ++subscriptionEpoch;
		set({
			turn: restoreSnapshot(
				emptyTurn(snapshot.sessionId, snapshot.turnId),
				snapshot,
			),
		});
		if (Option.isSome(snapshot.terminal)) {
			set({ pending: false });
			void refresh();
			return;
		}
		const recover = async () => {
			try {
				const latest = await bridge.snapshot(
					snapshot.sessionId,
					snapshot.turnId,
				);
				if (!disposed && generation === subscriptionEpoch) attach(latest);
			} catch (cause) {
				if (generation === subscriptionEpoch) fail(cause);
			}
		};
		off = bridge.subscribe(
			snapshot.sessionId,
			snapshot.turnId,
			(event) => {
				if (
					disposed ||
					generation !== subscriptionEpoch ||
					state.sessionId !== snapshot.sessionId ||
					!state.turn
				)
					return;
				const next =
					event._tag === "snapshot"
						? restoreSnapshot(state.turn, event.snapshot)
						: reduceChunk(state.turn, event.chunk);
				set({ turn: next });
				if (next.needsSnapshot) {
					off?.();
					void recover();
				} else if (Option.isSome(next.terminal)) {
					set({ pending: false });
					off?.();
					void refresh();
				}
			},
			(code) => {
				if (generation === subscriptionEpoch) {
					if (code === "CHAT.STREAM.RESYNC_REQUIRED") void recover();
					else set({ pending: false, error: code });
				}
			},
		);
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		refresh,
		submit: async (text: string) => {
			if (!bridge || disposed || state.pending || !text.trim()) return;
			const generation = epoch;
			const sessionId = state.sessionId,
				turnId = Schema.decodeUnknownSync(TurnId)(crypto.randomUUID());
			set({
				pending: true,
				input: text,
				error: "",
				turn: emptyTurn(sessionId, turnId),
			});
			try {
				const snapshot = await bridge.submit({ sessionId, turnId, text });
				if (!disposed && generation === epoch) attach(snapshot);
				else await bridge.cancel(sessionId, turnId);
			} catch (cause) {
				if (generation === epoch) fail(cause);
			}
		},
		select: async (sessionId?: SessionId) => {
			if (state.pending || disposed) return;
			off?.();
			subscriptionEpoch++;
			epoch++;
			const selected =
				sessionId ?? Schema.decodeUnknownSync(SessionId)(crypto.randomUUID());
			set({
				sessionId: selected,
				current: state.histories.find((item) => item.sessionId === selected),
				turn: undefined,
				input: "",
				error: "",
			});
			await refresh();
		},
		cancel: async () => {
			if (!bridge || !state.turn) return;
			try {
				await bridge.cancel(state.sessionId, state.turn.turnId);
			} catch (cause) {
				fail(cause);
			}
		},
		clear: async () => {
			if (!bridge || !state.current) return;
			try {
				await bridge.clear(state.sessionId);
				off?.();
				subscriptionEpoch++;
				epoch++;
				set({ turn: undefined, input: "", current: undefined, pending: false });
				await refresh();
			} catch (cause) {
				fail(cause);
			}
		},
		rename: async (title: string) => {
			if (!bridge || !state.current) return;
			try {
				await bridge.rename(state.sessionId, title);
				await refresh();
			} catch (cause) {
				fail(cause);
			}
		},
		dispose: () => {
			if (disposed) return;
			disposed = true;
			epoch++;
			subscriptionEpoch++;
			off?.();
			listeners.clear();
			if (bridge && state.pending && state.turn)
				void bridge
					.cancel(state.sessionId, state.turn.turnId)
					.catch(() => undefined);
		},
	};
}

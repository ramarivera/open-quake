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
	/** Stop was requested; the turn stays locked until its terminal outcome arrives. */
	readonly cancelling: boolean;
	readonly clearing: boolean;
	readonly loading: boolean;
	readonly navigating: boolean;
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
		cancelling: false,
		clearing: false,
		loading: true,
		navigating: false,
		error: "",
	};
	let off: (() => void) | undefined;
	let disposed = false,
		// Until the user picks or starts a conversation, the first history load
		// reopens the most recently updated saved conversation.
		chosen = false,
		// Stop pressed before the host accepted the turn; cancel once it's owned.
		cancelOnAccept = false,
		accepted = false,
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
	const requestCancel = async (sessionId: SessionId, turnId: TurnId) => {
		if (!bridge) return;
		try {
			await bridge.cancel(sessionId, turnId);
		} catch (cause) {
			// The turn may still be running; only its terminal outcome unlocks input.
			set({ cancelling: false, error: codeOf(cause) });
		}
	};
	const fail = (cause: unknown) =>
		set({
			pending: false,
			cancelling: false,
			loading: false,
			error: codeOf(cause),
		});
	const refresh = async () => {
		if (!bridge)
			return set({ loading: false, error: "CHAT.BRIDGE.UNAVAILABLE" });
		const generation = epoch,
			refresh = ++refreshEpoch;
		try {
			const histories = await bridge.list();
			if (generation !== epoch || refresh !== refreshEpoch) return;
			if (!chosen && !state.pending) {
				chosen = true;
				const latest = histories.reduce<PublicChatHistory | undefined>(
					(best, item) =>
						!best || item.updatedAt > best.updatedAt ? item : best,
					undefined,
				);
				if (latest) set({ sessionId: latest.sessionId });
			}
			const current = histories.find(
				(item) => item.sessionId === state.sessionId,
			);
			set({ histories, current, loading: false });
			const active = current?.turns.at(-1);
			if (active?.status === "processing" && !state.turn) {
				accepted = true;
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
			set({ pending: false, cancelling: false });
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
					set({ pending: false, cancelling: false });
					off?.();
					void refresh();
				}
			},
			(code) => {
				if (generation === subscriptionEpoch) {
					if (code === "CHAT.STREAM.RESYNC_REQUIRED") void recover();
					else set({ pending: false, cancelling: false, error: code });
				}
			},
		);
	};
	return {
		getSnapshot: () => state,
		navigationEpoch: () => epoch,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		refresh,
		dismissError: () => set({ error: "" }),
		submit: async (text: string): Promise<boolean> => {
			if (
				!bridge ||
				disposed ||
				state.pending ||
				state.clearing ||
				state.navigating ||
				!text.trim()
			)
				return false;
			chosen = true;
			cancelOnAccept = false;
			accepted = false;
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
				if (disposed || generation !== epoch) {
					await bridge.cancel(sessionId, turnId);
					return false;
				}
				accepted = true;
				attach(snapshot);
				if (cancelOnAccept && Option.isNone(snapshot.terminal)) {
					cancelOnAccept = false;
					await requestCancel(sessionId, turnId);
				}
				return true;
			} catch (cause) {
				if (generation === epoch) fail(cause);
				return false;
			}
		},
		select: async (
			sessionId?: SessionId,
			assistantGeneration?: number,
			expectedEpoch?: number,
		) => {
			if (
				(expectedEpoch !== undefined && expectedEpoch !== epoch) ||
				state.pending ||
				state.clearing ||
				disposed ||
				(assistantGeneration !== undefined && state.navigating)
			)
				return;
			chosen = true;
			off?.();
			subscriptionEpoch++;
			const generation = ++epoch;
			set({ navigating: assistantGeneration === undefined });
			const selected =
				sessionId ?? Schema.decodeUnknownSync(SessionId)(crypto.randomUUID());
			try {
				// Key-origin selection already chose its host destination. Desktop actions
				// compare against the current generation before replacing that destination.
				if (assistantGeneration === undefined && bridge?.navigate) {
					const current = await bridge.selection?.();
					if (disposed || generation !== epoch) return;
					await bridge.navigate(selected, current?.generation ?? null);
				}
				if (disposed || generation !== epoch) return;
				set({
					sessionId: selected,
					current: state.histories.find((item) => item.sessionId === selected),
					turn: undefined,
					input: "",
					error: "",
					navigating: false,
				});
				await refresh();
			} catch (cause) {
				if (generation === epoch) set({ error: codeOf(cause) });
			} finally {
				if (generation === epoch) set({ navigating: false });
			}
		},
		cancel: async () => {
			if (!bridge || !state.turn || !state.pending || state.cancelling) return;
			set({ cancelling: true });
			// The host rejects cancellation of a turn it hasn't accepted yet.
			if (!accepted) {
				cancelOnAccept = true;
				return;
			}
			await requestCancel(state.sessionId, state.turn.turnId);
		},
		clear: async () => {
			if (
				!bridge ||
				!state.current ||
				state.pending ||
				state.clearing ||
				state.navigating ||
				disposed
			)
				return;
			set({ clearing: true });
			try {
				await bridge.clear(state.sessionId);
				off?.();
				subscriptionEpoch++;
				epoch++;
				chosen = true;
				set({
					turn: undefined,
					input: "",
					current: undefined,
					pending: false,
					cancelling: false,
				});
				await refresh();
			} catch (cause) {
				fail(cause);
			} finally {
				set({ clearing: false });
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

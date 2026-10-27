import { useEffect, useRef } from "react";
import type { DirectChatBridge } from "../../../../shared/chat";
import type { createChatController } from "./controller";

/** Acknowledge after the visible composer owns the transcript. Never auto-send dictation. */
export function useAssistantSelection(
	bridge: DirectChatBridge | undefined,
	controller: ReturnType<typeof createChatController>,
	hidden: boolean,
	setText: (f: (draft: string) => string) => void,
) {
	const seen = useRef(0);
	useEffect(() => {
		if (hidden || !bridge?.selection) return;
		let alive = true;
		void bridge.assistantVisibility?.(true).catch(() => {});
		let timer: ReturnType<typeof setTimeout>;
		const read = async () => {
			try {
				const selection = await bridge.selection?.();
				if (!alive || !selection) return;
				// Retry a failed acknowledgement without installing the same dictation twice.
				if (selection.generation === seen.current) {
					await bridge.acknowledgeSelection?.(selection.generation);
					return;
				}
				const state = controller.getSnapshot();
				if (selection.generation < seen.current || state.pending || state.clearing) return;
				await controller.select(selection.sessionId);
				if (!alive) return;
				const latest = await bridge.selection?.();
				const current = controller.getSnapshot();
				if (
					!alive || latest?.generation !== selection.generation ||
					current.sessionId !== selection.sessionId || current.pending || current.clearing
				) return;
				seen.current = selection.generation;
				if (selection.transcript) setText(draft => draft ? `${draft}\n${selection.transcript}` : selection.transcript ?? draft);
				await bridge.acknowledgeSelection?.(selection.generation);
			} catch {
				// Keep the host selection pending for the next read.
			} finally {
				if (alive) timer = setTimeout(() => { void read(); }, 300);
			}
		};
		void read();
		return () => {
			alive = false;
			clearTimeout(timer);
			void bridge.assistantVisibility?.(false).catch(() => {});
		};
	}, [bridge, controller, hidden, setText]);
}

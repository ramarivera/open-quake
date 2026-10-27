import { useEffect, useRef } from "react";
import type { DirectChatBridge } from "../../../../shared/chat";
import type { createChatController } from "./controller";

/** Acknowledge only after the visible composer owns the transcript. Never auto-send dictation. */
export function useAssistantSelection(bridge: DirectChatBridge | undefined, controller: ReturnType<typeof createChatController>, hidden: boolean, setText: (f: (draft: string) => string) => void) {
  const seen = useRef(0);
  useEffect(() => {
    if (hidden || !bridge?.selection) return;
    let alive = true;
    void bridge.assistantVisibility?.(true);
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const selection = await bridge.selection?.();
        if (!alive) return;
        const state = controller.getSnapshot();
        if (selection && selection.generation > seen.current && !state.pending && !state.clearing) {
          await controller.select(selection.sessionId);
          if (!alive) return;
          // A newer selection during history loading must win before installing any text.
          const latest = await bridge.selection?.();
          if (!alive || latest?.generation !== selection.generation) return;
          seen.current = selection.generation;
          if (selection.transcript) setText(draft => draft ? `${draft}\n${selection.transcript}` : selection.transcript ?? draft);
          await bridge.acknowledgeSelection?.(selection.generation);
        }
      } catch { /* Keep the host selection pending for the next read. */ }
      finally { if (alive) timer = setTimeout(() => { void read(); }, 300); }
    };
    void read();
    return () => { alive = false; clearTimeout(timer); void bridge.assistantVisibility?.(false); };
  }, [bridge, controller, hidden, setText]);
}

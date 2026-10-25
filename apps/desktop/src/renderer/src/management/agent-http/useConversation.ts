import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type {
	AgentConversationsBridge,
	ConversationStart,
} from "../../../../shared/agent-conversations";
import { createConversationController } from "./conversation-controller";
import { useRuntimeCopy } from "./copy";

export function useConversation(
	bridge: AgentConversationsBridge | undefined,
	scope: Pick<ConversationStart, "connectionId" | "agentId" | "modelId">,
) {
	const { connectionId, agentId, modelId } = scope;
	const copy = useRuntimeCopy();
	const copyRef = useRef(copy);
	copyRef.current = copy;
	const controller = useMemo(
		() =>
			createConversationController(
				bridge,
				{
					connectionId,
					...(agentId === undefined ? {} : { agentId }),
					...(modelId === undefined ? {} : { modelId }),
				},
				undefined,
				() => copyRef.current,
			),
		[bridge, connectionId, agentId, modelId],
	);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	useEffect(() => {
		controller.start();
		return controller.dispose;
	}, [controller]);
	return {
		...state,
		send: controller.send,
		cancel: controller.cancel,
		clear: controller.clear,
		refresh: controller.refresh,
		selectSession: controller.selectSession,
		dismissError: controller.dismissError,
	};
}

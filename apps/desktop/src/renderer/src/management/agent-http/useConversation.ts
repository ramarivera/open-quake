import { useEffect, useMemo, useSyncExternalStore } from "react";
import type {
	AgentConversationsBridge,
	ConversationScope,
} from "../../../../shared/agent-conversations";
import { createConversationController } from "./conversation-controller";

export function useConversation(
	bridge: AgentConversationsBridge | undefined,
	scope: Pick<ConversationScope, "connectionId" | "agentId">,
) {
	const { connectionId, agentId } = scope;
	const controller = useMemo(
		() =>
			createConversationController(bridge, {
				connectionId,
				...(agentId === undefined ? {} : { agentId }),
			}),
		[bridge, connectionId, agentId],
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

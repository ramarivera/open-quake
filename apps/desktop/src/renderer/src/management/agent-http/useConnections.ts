import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentConnectionsBridge } from "../../../../shared/agent-connections";
import { createConnectionsController } from "./connections-controller";

export function useConnections(bridge: AgentConnectionsBridge | undefined) {
	const controller = useMemo(
		() => createConnectionsController(bridge),
		[bridge],
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
		request: controller.request,
		dismissError: controller.dismissError,
	};
}

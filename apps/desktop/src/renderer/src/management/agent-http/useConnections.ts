import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AgentConnectionsBridge } from "../../../../shared/agent-connections";
import { createConnectionsController } from "./connections-controller";
import { useRuntimeCopy } from "./copy";

export function useConnections(bridge: AgentConnectionsBridge | undefined) {
	const copy = useRuntimeCopy();
	const copyRef = useRef(copy);
	copyRef.current = copy;
	const controller = useMemo(
		() => createConnectionsController(bridge, () => copyRef.current),
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
		saveAndSelect: controller.saveAndSelect,
		dismissError: controller.dismissError,
	};
}

import { useEffect, useState } from "react";
import type { KeyRuntimeState } from "../../../shared/key-library";
export function useKeyRuntime(): ReadonlyMap<string, KeyRuntimeState> {
	const [states, setStates] = useState<ReadonlyMap<string, KeyRuntimeState>>(
		new Map(),
	);
	useEffect(() => {
		let live = true;
		const accept = (state: KeyRuntimeState): void => {
			if (live)
				setStates((previous) => {
					const key = JSON.stringify([
						state.deviceId,
						state.profileId,
						state.pageId,
						state.keyCode,
					]);
					const old = previous.get(key);
					return new Map(previous).set(key, {
						...(old?.revision === state.revision ? old : undefined),
						...state,
					});
				});
		};
		const off = window.quakeKeyLibrary?.onRuntime(accept);
		void window.quakeKeyLibrary
			?.request({ type: "read", locale: "en" })
			.then((reply) => {
				if (reply._tag === "success")
					for (const state of reply.states ?? []) accept(state);
			})
			.catch(() => {
				/* Disposal may close the IPC transport before the initial read. */
			});
		return () => {
			live = false;
			off?.();
		};
	}, []);
	return states;
}

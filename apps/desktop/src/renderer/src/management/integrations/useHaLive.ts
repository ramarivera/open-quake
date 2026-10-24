import { useEffect, useState } from "react";
import type { HaLive } from "../../../../../../../packages/edge/src/home-assistant/ha-contracts";
export function useHaLive(): HaLive {
	const [live, setLive] = useState<HaLive>({ connected: false, states: [] });
	useEffect(() => {
		const bridge = window.quakeIntegrations;
		if (!bridge) return;
		let active = true;
		let received = false;
		const unsubscribe = bridge.onHaLive((value) => {
			received = true;
			if (active) setLive(value);
		});
		void bridge
			.request({ type: "ha.live" })
			.then((reply) => {
				if (active && !received && reply.type === "live") setLive(reply.live);
			})
			.catch(() => {
				if (active) setLive({ connected: false, states: [] });
			});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);
	return live;
}

import { Schema } from "effect";
import { useEffect, useState } from "react";
import {
	defaults,
	emptySnapshot,
	MonitorReply,
	type MonitorSettings,
	MonitorSnapshot,
	SettingsView,
} from "../../../../../shared/monitor-contracts";
export function useMonitor(live = false) {
	const [view, setView] = useState<SettingsView>();
	const [snapshot, setSnapshot] = useState<MonitorSnapshot>(emptySnapshot);
	useEffect(() => {
		const bridge = window.quakeMonitor;
		if (!bridge) return;
		let active = true;
		const update = (value: unknown): void => {
			if (active && Schema.is(SettingsView)(value)) setView(value);
		};
		const offSettings = bridge.onSettings(update);
		const offMetrics = live
			? bridge.onMetrics((value) => {
					if (active && Schema.is(MonitorSnapshot)(value)) setSnapshot(value);
				})
			: () => undefined;
		void bridge
			.request({ _tag: "read" })
			.then((value) => {
				if (Schema.is(MonitorReply)(value) && value._tag === "success")
					update(value.view);
			})
			.catch(() => undefined);
		if (live)
			void bridge
				.request({ _tag: "watch", active: true })
				.catch(() => undefined);
		return () => {
			active = false;
			offSettings();
			offMetrics();
			if (live)
				void bridge
					.request({ _tag: "watch", active: false })
					.catch(() => undefined);
		};
	}, [live]);
	return {
		view,
		snapshot: view?.settings.enabled === false ? emptySnapshot() : snapshot,
		settings: view?.settings ?? defaults(),
	};
}
export const settingsWithoutMedia = (
	settings: MonitorSettings,
	style: MonitorSettings["styleId"],
): MonitorSettings => {
	const media = { ...settings.media };
	delete media[style];
	return { ...settings, media };
};

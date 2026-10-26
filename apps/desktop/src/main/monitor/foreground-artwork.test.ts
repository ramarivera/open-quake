import { expect, it, vi } from "vitest";
import {
	emptySnapshot,
	MONITOR_STATE,
	type MonitoringSnapshot,
} from "../../shared/monitor-contracts";
import { publishMonitoringState } from "./foreground-artwork";

const snapshot: MonitoringSnapshot = {
	metrics: emptySnapshot(),
	foreground: {
		state: "available",
		collectedAt: 1,
		window: {
			id: "private-window",
			path: "/Users/private/Secret.app/Contents/MacOS/Secret",
		},
	},
};
it("keeps foreground paths out of every panel monitoring payload", () => {
	const management = vi.fn(),
		panel = vi.fn();
	publishMonitoringState(snapshot, management, panel);
	expect(management).toHaveBeenCalledWith(MONITOR_STATE, snapshot);
	expect(JSON.stringify(panel.mock.calls)).not.toContain("/Users/private");
	expect(JSON.stringify(panel.mock.calls)).not.toContain('"path"');
	expect(panel.mock.calls.some(([channel]) => channel === MONITOR_STATE)).toBe(
		false,
	);
});

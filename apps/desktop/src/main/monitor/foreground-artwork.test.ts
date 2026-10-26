import { expect, it, vi } from "vitest";
import {
	emptySnapshot,
	MONITOR_STATE,
	type MonitoringSnapshot,
} from "../../shared/monitor-contracts";
import {
	foregroundArtwork,
	publishMonitoringState,
} from "./foreground-artwork";

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

it("reuses foreground artwork across metric-only samples and normalized app identities", async () => {
	const data = "data:image/png;base64,AAAA";
	const load = vi.fn(async () => ({
		id: "applications",
		name: "Apps",
		icons: [
			{
				id: "a".repeat(64),
				name: "Secret",
				tags: [],
				extraData: ["/Users/private/Secret.app"],
				data,
			},
		],
	}));
	const resolve = foregroundArtwork(load);
	expect(await resolve(snapshot)).toEqual({ artwork: data });
	load.mockClear();
	for (let sample = 2; sample < 12; sample++) {
		expect(
			await resolve({
				metrics: { ...snapshot.metrics, sampledAt: sample },
				foreground: {
					state: "available",
					collectedAt: sample,
					window: { id: String(sample), path: "/users/PRIVATE/secret.APP" },
				},
			}),
		).toEqual({ artwork: data });
	}
	expect(load).not.toHaveBeenCalled();
	expect(
		await resolve({
			...snapshot,
			foreground: { state: "disabled", collectedAt: 20 },
		}),
	).toEqual({ artwork: "" });
	expect(load).not.toHaveBeenCalled();
	await resolve(snapshot);
	expect(load).toHaveBeenCalledOnce();
});
it("shares an in-flight foreground lookup across samples", async () => {
	const load = vi.fn(async () => ({
		id: "applications",
		name: "Apps",
		icons: [],
	}));
	const resolve = foregroundArtwork(load);
	await Promise.all(Array.from({ length: 10 }, () => resolve(snapshot)));
	expect(load).toHaveBeenCalledOnce();
});

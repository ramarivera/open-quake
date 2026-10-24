import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants.js";
import {
	AGENTS_PROGRESS,
	AGENTS_REQUEST,
	AGENTS_SNAPSHOT,
} from "../../shared/agents";

const electron = vi.hoisted(() => ({
	invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(),
	on: vi.fn(),
	off: vi.fn(),
	expose: vi.fn(),
}));
vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: electron.expose },
	ipcRenderer: { invoke: electron.invoke, on: electron.on, off: electron.off },
}));

import { agentsBridge } from "./preload";

const view = () => {
	const state = initialAgentState();
	return {
		...state,
		models: {},
		runtime: {
			available: false,
			status: "stopped",
			code: "AGENT.RUNTIME.UNAVAILABLE",
			operation: "none",
		},
		progress: { percent: 0, stage: "idle", deviceApplied: false },
		draftingAvailable: false,
	};
};
describe("agent preload real bridge", () => {
	beforeEach(() => vi.clearAllMocks());
	it("invokes only the agent request channel and validates native replies", async () => {
		electron.invoke.mockResolvedValue({
			_tag: "rejected",
			code: "AGENT.RUNTIME.UNAVAILABLE",
			message: "No agent runtime is installed",
		});
		expect(
			await agentsBridge.request({ type: "runtime", action: "start" }),
		).toMatchObject({ code: "AGENT.RUNTIME.UNAVAILABLE" });
		expect(electron.invoke).toHaveBeenCalledWith(AGENTS_REQUEST, {
			type: "runtime",
			action: "start",
		});
		electron.invoke.mockResolvedValue({ malformed: true });
		await expect(agentsBridge.request({ type: "read" })).rejects.toBeDefined();
	});
	it("validates event payloads and removes both subscriptions", () => {
		const snapshot = vi.fn(),
			progress = vi.fn();
		const off = agentsBridge.onSnapshot(snapshot);
		const offProgress = agentsBridge.onProgress(progress);
		const snapshotCall = electron.on.mock.calls.find(
			(call) => call[0] === AGENTS_SNAPSHOT,
		);
		const progressCall = electron.on.mock.calls.find(
			(call) => call[0] === AGENTS_PROGRESS,
		);
		expect(snapshotCall).toBeDefined();
		expect(progressCall).toBeDefined();
		const notifySnapshot: unknown = snapshotCall?.[1],
			notifyProgress: unknown = progressCall?.[1];
		if (typeof notifySnapshot === "function") {
			notifySnapshot({}, view());
			notifySnapshot({}, { invalid: true });
		}
		if (typeof notifyProgress === "function") {
			notifyProgress(
				{},
				{ percent: 40, stage: "profile", deviceApplied: false },
			);
			notifyProgress({}, { percent: 999, stage: "unknown" });
		}
		expect(snapshot).toHaveBeenCalledTimes(1);
		expect(progress).toHaveBeenCalledTimes(1);
		off();
		offProgress();
		expect(electron.off).toHaveBeenCalledWith(AGENTS_SNAPSHOT, notifySnapshot);
		expect(electron.off).toHaveBeenCalledWith(AGENTS_PROGRESS, notifyProgress);
	});
});

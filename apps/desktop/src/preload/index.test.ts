import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenQuakeBridge, QuakeEvent } from "./quake";

const electron = vi.hoisted(() => ({
	contextBridge: {
		exposeInMainWorld: vi.fn<(name: string, bridge: OpenQuakeBridge) => void>(),
	},
	ipcRenderer: {
		on: vi.fn<
			(
				channel: string,
				listener: (event: unknown, payload: QuakeEvent) => void,
			) => void
		>(),
		off: vi.fn(),
		send: vi.fn(),
	},
}));
vi.mock("electron", () => electron);

describe("device preload bridge", () => {
	beforeEach(async () => {
		vi.resetModules();
		await import("./index");
	});

	it("registers before requesting status, delivers typed events, and unsubscribes", () => {
		const bridge = electron.contextBridge.exposeInMainWorld.mock.calls[0]?.[1];
		expect(bridge).toBeDefined();
		const callback = vi.fn();
		const unsubscribe = bridge?.onQuakeEvent(callback);
		const [channel, listener] = electron.ipcRenderer.on.mock.calls[0] ?? [];
		expect(channel).toBe("quake:event");
		expect(electron.ipcRenderer.send).toHaveBeenCalledExactlyOnceWith(
			"quake:status",
		);
		expect(electron.ipcRenderer.on.mock.invocationCallOrder[0]).toBeLessThan(
			electron.ipcRenderer.send.mock.invocationCallOrder[0] ?? 0,
		);
		const status: QuakeEvent = {
			source: "hid",
			kind: "status",
			state: "error",
			error: {
				_tag: "QuakeDeviceNotFound",
				code: "QUAKE.DEVICE.NOT_FOUND",
				category: "unavailable",
			},
		};
		listener?.({}, status);
		expect(callback).toHaveBeenCalledExactlyOnceWith(status);
		unsubscribe?.();
		expect(electron.ipcRenderer.off).toHaveBeenCalledExactlyOnceWith(
			"quake:event",
			listener,
		);
	});
});

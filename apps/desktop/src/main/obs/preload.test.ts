import { afterEach, expect, it, vi } from "vitest";
import { OBS_LIVE, OBS_REQUEST } from "../../shared/obs";

const electron = vi.hoisted(() => ({
	contextBridge: { exposeInMainWorld: vi.fn() },
	ipcRenderer: {
		invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(),
		on: vi.fn(),
		off: vi.fn(),
	},
}));
vi.mock("electron", () => electron);

import { obsBridge } from "./preload";

afterEach(() => vi.clearAllMocks());

it("validates IPC requests and replies and removes its live subscription", async () => {
	electron.ipcRenderer.invoke.mockResolvedValue({ type: "ok" });
	await expect(
		obsBridge.request({ type: "visible", lease: "fixture", tiles: [] }),
	).resolves.toEqual({ type: "ok" });
	expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(OBS_REQUEST, {
		type: "visible",
		lease: "fixture",
		tiles: [],
	});
	electron.ipcRenderer.invoke.mockResolvedValue({
		type: "status",
		status: { password: "private" },
	});
	await expect(obsBridge.request({ type: "status" })).rejects.toBeDefined();
	const receive = vi.fn();
	const off = obsBridge.onLive(receive);
	const listener = electron.ipcRenderer.on.mock.calls[0]?.[1];
	if (typeof listener !== "function")
		throw new TypeError("Missing OBS listener");
	listener({}, { lease: "fixture", tiles: [] });
	listener({}, { lease: "fixture", tiles: [{ image: "invalid" }] });
	expect(receive).toHaveBeenCalledTimes(1);
	off();
	expect(electron.ipcRenderer.off).toHaveBeenCalledWith(OBS_LIVE, listener);
});

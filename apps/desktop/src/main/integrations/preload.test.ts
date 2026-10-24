import { afterEach, describe, expect, it, vi } from "vitest";
import {
	INTEGRATIONS_LIVE,
	INTEGRATIONS_REQUEST,
} from "../../shared/integrations";
import { integrationFixture } from "./test-fixtures";

const electron = vi.hoisted(() => ({
	contextBridge: { exposeInMainWorld: vi.fn() },
	ipcRenderer: {
		invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(),
		on: vi.fn(),
		off: vi.fn(),
	},
}));
vi.mock("electron", () => electron);

import { integrationsBridge } from "./preload";

afterEach(() => vi.clearAllMocks());
describe("the production preload consumer", () => {
	it("calls the real decoded controller with fake ports, returns safe status and unregisters live listeners", async () => {
		const f = integrationFixture();
		try {
			electron.ipcRenderer.invoke.mockImplementation(async (channel, input) => {
				expect(channel).toBe(INTEGRATIONS_REQUEST);
				return f.request(input);
			});
			const reply = await integrationsBridge.request({
				type: "ha.connect",
				origin: "http://home.test:8123/path",
				token: "private-a9F2",
			});
			expect(reply).toMatchObject({
				type: "ha",
				snapshot: { tokenMask: "••••a9F2", state: "Connected" },
			});
			expect(JSON.stringify(reply)).not.toContain("private-");
			const receive = vi.fn();
			const unsubscribe = integrationsBridge.onHaLive(receive);
			const listener = electron.ipcRenderer.on.mock.calls[0]?.[1];
			if (typeof listener !== "function") throw new TypeError("No listener");
			listener({}, { connected: true, states: [] });
			listener({}, { connected: "fake", states: [] });
			expect(receive).toHaveBeenCalledTimes(1);
			unsubscribe();
			expect(electron.ipcRenderer.off).toHaveBeenCalledWith(
				INTEGRATIONS_LIVE,
				listener,
			);
		} finally {
			await f.dispose();
		}
	});
});

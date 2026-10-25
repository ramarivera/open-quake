import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { AGENT_CONNECTIONS_REQUEST } from "../../shared/agent-connections";
import { registerUnavailableAgentConnections } from "./unavailable-registration";

const ipc = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }));
vi.mock("electron", () => ({ ipcMain: ipc }));
beforeEach(() => vi.clearAllMocks());

const renderer = "file:///open-quake/renderer/index.html";
function fixture() {
	const frame = { url: renderer };
	let destroyed = false;
	const sender = { id: 7, mainFrame: frame };
	const window = {
		isDestroyed: () => destroyed,
		webContents: sender,
	} as unknown as BrowserWindow;
	const dispose = registerUnavailableAgentConnections({
		management: () => window,
		renderer,
	});
	const handler = ipc.handle.mock.calls[0]?.[1];
	if (!handler) throw new Error("Missing unavailable connection handler");
	const event = { sender, senderFrame: frame } as unknown as IpcMainInvokeEvent;
	return {
		handler,
		event,
		dispose,
		destroy: () => {
			destroyed = true;
		},
	};
}

it("reports absent initialization through the existing catalog reply and removes its handler", () => {
	const f = fixture();
	expect(ipc.handle.mock.calls[0]?.[0]).toBe(AGENT_CONNECTIONS_REQUEST);
	expect(f.handler(f.event, { type: "list" })).toEqual({
		_tag: "rejected",
		code: "AGENT.HTTP.CONNECTION.UNAVAILABLE",
		message: "The runtime is unavailable",
	});
	expect(f.handler(f.event, { type: "list", unexpected: true })).toMatchObject({
		_tag: "rejected",
		code: "AGENT.HTTP.CONNECTION.INVALID",
	});
	f.dispose();
	f.dispose();
	expect(ipc.removeHandler).toHaveBeenCalledExactlyOnceWith(
		AGENT_CONNECTIONS_REQUEST,
	);
	expect(f.handler(f.event, { type: "list" }).code).toBe(
		"AGENT.HTTP.IPC.UNAUTHORIZED",
	);
});

it("rejects foreign windows, frames, URLs and destroyed management windows", () => {
	const f = fixture();
	for (const event of [
		{ ...f.event, sender: { ...f.event.sender, id: 8 } },
		{ ...f.event, senderFrame: { url: renderer } },
		{ ...f.event, senderFrame: undefined },
	]) {
		expect(f.handler(event, { type: "list" }).code).toBe(
			"AGENT.HTTP.IPC.UNAUTHORIZED",
		);
	}
	const foreign = { url: "file:///other/index.html" };
	expect(
		f.handler(
			{ sender: { id: 7, mainFrame: foreign }, senderFrame: foreign },
			{ type: "list" },
		).code,
	).toBe("AGENT.HTTP.IPC.UNAUTHORIZED");
	f.destroy();
	expect(f.handler(f.event, { type: "list" }).code).toBe(
		"AGENT.HTTP.IPC.UNAUTHORIZED",
	);
	f.dispose();
});

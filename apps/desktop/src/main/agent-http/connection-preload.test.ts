import { describe, expect, it, vi } from "vitest";
import {
	AGENT_CONNECTIONS_REQUEST,
	AGENT_CONNECTIONS_SNAPSHOT,
	type AgentConnectionView,
} from "../../shared/agent-connections";
import { createAgentConnectionsBridge } from "./connection-preload";

const view: AgentConnectionView = {
	revision: 0,
	connections: [],
	cleanupPending: false,
};
function fixture() {
	const listeners = new Map<string, (event: unknown, input: unknown) => void>();
	const ipc = {
		invoke: vi.fn<(channel: string, input: unknown) => Promise<unknown>>(),
		on: vi.fn(
			(channel: string, listener: (event: unknown, input: unknown) => void) => {
				listeners.set(channel, listener);
			},
		),
		off: vi.fn((channel: string) => {
			listeners.delete(channel);
		}),
	};
	return { ipc, listeners, bridge: createAgentConnectionsBridge(ipc) };
}
describe("runtime connection preload factory", () => {
	it("uses one fixed channel and validates native replies without exposing additional fields", async () => {
		const f = fixture();
		f.ipc.invoke.mockResolvedValue({ _tag: "success", view });
		expect(await f.bridge.request({ type: "list" })).toEqual({
			_tag: "success",
			view,
		});
		expect(f.ipc.invoke).toHaveBeenCalledExactlyOnceWith(
			AGENT_CONNECTIONS_REQUEST,
			{ type: "list" },
		);
		for (const value of [
			{ _tag: "success", view, secret: "token" },
			{ _tag: "success", view: { ...view, credentialRef: "secret" } },
			{
				_tag: "success",
				view: {
					...view,
					connections: [
						{
							id: "x",
							kind: "hermes",
							name: "x",
							baseURL: "http://localhost",
							credentialAvailable: true,
							credentialRef: "secret",
						},
					],
				},
			},
			{ malformed: true },
		]) {
			f.ipc.invoke.mockResolvedValue(value);
			await expect(f.bridge.request({ type: "list" })).rejects.toBeDefined();
		}
	});
	it("accepts strict secret-free snapshots and disposes exact listener once", () => {
		const f = fixture(),
			receive = vi.fn();
		const off = f.bridge.onSnapshot(receive);
		const listener = f.listeners.get(AGENT_CONNECTIONS_SNAPSHOT);
		expect(listener).toBeDefined();
		listener?.({}, view);
		listener?.({}, { ...view, secret: "token" });
		listener?.({}, { broken: true });
		expect(receive).toHaveBeenCalledExactlyOnceWith(view);
		off();
		off();
		expect(f.ipc.off).toHaveBeenCalledExactlyOnceWith(
			AGENT_CONNECTIONS_SNAPSHOT,
			listener,
		);
		listener?.({}, view);
		expect(receive).toHaveBeenCalledTimes(1);
	});
});

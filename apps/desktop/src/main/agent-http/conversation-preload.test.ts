import { describe, expect, it, vi } from "vitest";
import {
	AGENT_CONVERSATIONS_EVENT,
	AGENT_CONVERSATIONS_REQUEST,
	type ConversationEvent,
} from "../../shared/agent-conversations.js";
import {
	type ConversationRendererIPC,
	createAgentConversationsBridge,
} from "./conversation-preload.js";

function ipcFixture() {
	const native = new Map<string, (event: unknown, input: unknown) => void>();
	const invoke = vi.fn(
		async (_channel: string, _input: unknown): Promise<unknown> => ({
			_tag: "success",
			history: [],
		}),
	);
	const on = vi.fn(
		(channel: string, listener: (event: unknown, input: unknown) => void) => {
			native.set(channel, listener);
		},
	);
	const removeListener = vi.fn((channel: string) => native.delete(channel));
	const ipc: ConversationRendererIPC = { invoke, on, removeListener };
	return {
		ipc,
		invoke,
		on,
		removeListener,
		emit: (value: unknown) =>
			native.get(AGENT_CONVERSATIONS_EVENT)?.({}, value),
	};
}
const event: ConversationEvent = {
	type: "provider",
	connectionId: "connection",
	requestId: "request",
	sessionId: "session",
	seq: 0,
	event: { _tag: "textDelta", textDelta: "hello", kind: "generation" },
};
describe("actual conversation preload factory", () => {
	it("uses only the conversation channel and validates native replies", async () => {
		const native = ipcFixture();
		const bridge = createAgentConversationsBridge(native.ipc);
		await bridge.request({ type: "history", connectionId: "connection" });
		expect(native.invoke).toHaveBeenCalledWith(AGENT_CONVERSATIONS_REQUEST, {
			type: "history",
			connectionId: "connection",
		});
		native.invoke.mockResolvedValue({
			_tag: "success",
			history: [],
			credential: "private",
		});
		await expect(
			bridge.request({ type: "history", connectionId: "connection" }),
		).rejects.toBeDefined();
	});
	it("validates events, waits for all consumers before ack and unsubscribes only the final listener", async () => {
		const native = ipcFixture();
		const bridge = createAgentConversationsBridge(native.ipc);
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const callback = vi.fn(() => pending);
		const other = vi.fn();
		const off = bridge.onEvent(callback),
			offOther = bridge.onEvent(other);
		expect(native.on).toHaveBeenCalledTimes(1);
		native.emit({ ...event, event: { _tag: "invented" } });
		native.emit(event);
		await Promise.resolve();
		expect(callback).toHaveBeenCalledOnce();
		expect(other).toHaveBeenCalledOnce();
		expect(native.invoke).not.toHaveBeenCalled();
		finish();
		await vi.waitFor(() =>
			expect(native.invoke).toHaveBeenCalledWith(AGENT_CONVERSATIONS_REQUEST, {
				type: "ack",
				requestId: "request",
				seq: 0,
			}),
		);
		off();
		off();
		expect(native.removeListener).not.toHaveBeenCalled();
		offOther();
		expect(native.removeListener).toHaveBeenCalledOnce();
		expect(native.invoke).toHaveBeenLastCalledWith(
			AGENT_CONVERSATIONS_REQUEST,
			{ type: "unsubscribe" },
		);
	});
	it("consumer failure cancels actual main stream instead of acknowledging dropped content", async () => {
		const native = ipcFixture();
		const bridge = createAgentConversationsBridge(native.ipc);
		const off = bridge.onEvent(() =>
			Promise.reject(new Error("consumer failed")),
		);
		native.emit(event);
		await vi.waitFor(() =>
			expect(native.invoke).toHaveBeenCalledWith(AGENT_CONVERSATIONS_REQUEST, {
				type: "cancel",
				requestId: "request",
			}),
		);
		expect(
			native.invoke.mock.calls.some(
				([, input]) =>
					typeof input === "object" &&
					input !== null &&
					"type" in input &&
					input.type === "ack",
			),
		).toBe(false);
		off();
	});
});

import { describe, expect, it, vi } from "vitest";
import type {
	AgentConversationsBridge,
	ConversationCommand,
	ConversationEvent,
	ConversationHistory,
	ConversationReply,
} from "../../../../shared/agent-conversations";
import { createConversationController } from "./conversation-controller";

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
const success = (): ConversationReply => ({ _tag: "success", history: [] });
const tick = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
function harness(
	respond: (
		command: ConversationCommand,
	) => Promise<ConversationReply> = async () => success(),
) {
	let receive: ((event: ConversationEvent) => void | Promise<void>) | undefined;
	const off = vi.fn();
	const request = vi.fn(respond);
	const bridge: AgentConversationsBridge = {
		request,
		onEvent: (callback) => {
			receive = callback;
			return off;
		},
	};
	let serial = 0;
	const controller = createConversationController(
		bridge,
		{ connectionId: "hermes" },
		() => `request-${++serial}`,
	);
	controller.start();
	const event = (value: ConversationEvent) => {
		void receive?.(value);
	};
	const delta = (seq: number, textDelta: string): ConversationEvent => ({
		connectionId: "hermes",
		sessionId: "request-1",
		requestId: "request-1",
		seq,
		type: "provider",
		event: { _tag: "textDelta", kind: "generation", textDelta },
	});
	return { controller, request, off, event, delta };
}

describe("runtime conversation UI controller", () => {
	it("keeps model alias history separate and starts a fresh scope when switching aliases", async () => {
		const request = vi.fn(
			async (command: ConversationCommand): Promise<ConversationReply> =>
				command.type === "history"
					? {
							_tag: "success",
							history: [
								{
									connectionId: "hermes",
									sessionId: "default-session",
									turns: [],
								},
								{
									connectionId: "hermes",
									modelId: "fast",
									sessionId: "fast-session",
									turns: [],
								},
								{
									connectionId: "hermes",
									modelId: "slow",
									sessionId: "slow-session",
									turns: [],
								},
							],
						}
					: success(),
		);
		const bridge: AgentConversationsBridge = {
			request,
			onEvent: () => () => {},
		};
		const fast = createConversationController(
			bridge,
			{ connectionId: "hermes", modelId: "fast" },
			() => "fast-turn",
		);
		fast.start();
		await tick();
		expect(
			fast.getSnapshot().history.map((session) => session.sessionId),
		).toEqual(["fast-session"]);
		fast.selectSession("default-session");
		expect(fast.getSnapshot().sessionId).toBeUndefined();
		fast.selectSession("fast-session");
		expect(await fast.send("hello fast")).toBe(true);
		expect(request).toHaveBeenCalledWith({
			type: "start",
			connectionId: "hermes",
			modelId: "fast",
			sessionId: "fast-session",
			requestId: "fast-turn",
			text: "hello fast",
		});
		fast.dispose();
		const slow = createConversationController(
			bridge,
			{ connectionId: "hermes", modelId: "slow" },
			() => "slow-turn",
		);
		slow.start();
		await tick();
		expect(
			slow.getSnapshot().history.map((session) => session.sessionId),
		).toEqual(["slow-session"]);
		expect(slow.getSnapshot().sessionId).toBeUndefined();
		expect(await slow.send("hello slow")).toBe(true);
		expect(request).toHaveBeenCalledWith({
			type: "start",
			connectionId: "hermes",
			modelId: "slow",
			requestId: "slow-turn",
			text: "hello slow",
		});
		slow.dispose();
	});
	it("uses the Hermes endpoint default and retains text delivered before the start acknowledgement", async () => {
		const start = deferred<ConversationReply>();
		const h = harness(async (command) =>
			command.type === "start" ? start.promise : success(),
		);
		await tick();
		const sending = h.controller.send("Hello");
		h.event(h.delta(0, "First "));
		h.event(h.delta(1, "answer"));
		start.resolve({
			_tag: "success",
			history: [],
			requestId: "request-1",
			sessionId: "request-1",
		});
		expect(await sending).toBe(true);
		expect(h.request).toHaveBeenCalledWith({
			type: "start",
			connectionId: "hermes",
			requestId: "request-1",
			text: "Hello",
		});
		expect(h.controller.getSnapshot().history[0]?.turns[0]?.answer).toBe(
			"First answer",
		);
		h.event({
			connectionId: "hermes",
			sessionId: "request-1",
			requestId: "request-1",
			seq: 2,
			type: "provider",
			event: { _tag: "completed" },
		});
		expect(h.controller.getSnapshot().active).toBeDefined();
		h.event({
			connectionId: "hermes",
			sessionId: "request-1",
			requestId: "request-1",
			seq: 3,
			type: "end",
			outcome: "completed",
		});
		expect(h.controller.getSnapshot().active).toBeUndefined();
		expect(h.controller.getSnapshot().history[0]?.turns[0]?.outcome).toBe(
			"completed",
		);
		h.controller.dispose();
	});

	it("rejects foreign, duplicate and out-of-order events and drops late text after cancel acknowledgement", async () => {
		const h = harness();
		await tick();
		await h.controller.send("Hello");
		h.event(h.delta(2, "accepted"));
		h.event(h.delta(2, "duplicate"));
		h.event(h.delta(1, "old"));
		h.event({ ...h.delta(3, "other connection"), connectionId: "other" });
		h.event({ ...h.delta(3, "other agent"), agentId: "foreign" });
		h.event({ ...h.delta(3, "other request"), requestId: "foreign" });
		h.event({ ...h.delta(3, "other session"), sessionId: "foreign" });
		h.controller.selectSession(undefined);
		expect(h.controller.getSnapshot().sessionId).toBe("request-1");
		await h.controller.cancel();
		h.event(h.delta(4, "late"));
		expect(h.controller.getSnapshot().history[0]?.turns[0]).toMatchObject({
			answer: "accepted",
			outcome: "cancelled",
		});
		expect(h.request).toHaveBeenCalledWith({
			type: "cancel",
			requestId: "request-1",
		});
		h.controller.dispose();
	});

	it("keeps cancellation retryable when main rejects it", async () => {
		let rejectCancel = true;
		const h = harness(async (command) =>
			command.type === "cancel" && rejectCancel
				? {
						_tag: "rejected",
						code: "AGENT.HTTP.REQUEST.FAILED",
						message: "Retry cancellation",
					}
				: success(),
		);
		await tick();
		await h.controller.send("Hello");
		await h.controller.cancel();
		expect(h.controller.getSnapshot().active).toBeDefined();
		expect(h.controller.getSnapshot().error?.code).toBe(
			"AGENT.HTTP.REQUEST.FAILED",
		);
		rejectCancel = false;
		await h.controller.cancel();
		expect(h.controller.getSnapshot().active).toBeUndefined();
		h.controller.dispose();
	});

	it("doesn't let a cancelled turn's delayed start acknowledgement change a newer turn", async () => {
		const first = deferred<ConversationReply>();
		const second = deferred<ConversationReply>();
		let starts = 0;
		const h = harness(async (command) =>
			command.type === "start"
				? ++starts === 1
					? first.promise
					: second.promise
				: success(),
		);
		await tick();
		const firstSend = h.controller.send("First");
		await h.controller.cancel();
		h.controller.selectSession(undefined);
		const secondSend = h.controller.send("Second");
		first.resolve({
			_tag: "rejected",
			code: "AGENT.HTTP.REQUEST.FAILED",
			message: "Delayed first rejection",
		});
		expect(await firstSend).toBe(false);
		expect(h.controller.getSnapshot().active?.requestId).toBe("request-2");
		expect(h.controller.getSnapshot().pending).toBe("starting");
		expect(h.controller.getSnapshot().error).toBeUndefined();
		second.resolve(success());
		expect(await secondSend).toBe(true);
		h.controller.dispose();
	});

	it("retains partial failures and only displays actual tool and usage events", async () => {
		const h = harness();
		await tick();
		await h.controller.send("Hello");
		expect(h.controller.getSnapshot().tools).toEqual([]);
		expect(h.controller.getSnapshot().usage).toBeUndefined();
		h.event(h.delta(0, "Partial"));
		const identity = {
			connectionId: "hermes",
			sessionId: "request-1",
			requestId: "request-1",
		};
		h.event({
			...identity,
			seq: 1,
			type: "provider",
			event: {
				_tag: "tool",
				toolCallId: "read",
				tool: "read_file",
				phase: "running",
			},
		});
		h.event({
			...identity,
			seq: 2,
			type: "provider",
			event: {
				_tag: "tool",
				toolCallId: "read",
				tool: "read_file",
				phase: "completed",
			},
		});
		h.event({
			...identity,
			seq: 3,
			type: "provider",
			event: {
				_tag: "usage",
				usage: { inputTokens: 10, outputTokens: 2, provenance: "reported" },
			},
		});
		h.event({
			...identity,
			seq: 4,
			type: "end",
			outcome: "failed",
			errorCode: "AGENT.HTTP.REQUEST.TIMEOUT",
			message: "Runtime timed out",
		});
		expect(h.controller.getSnapshot().tools).toHaveLength(1);
		expect(h.controller.getSnapshot().tools[0]?.phase).toBe("completed");
		expect(h.controller.getSnapshot().usage?.inputTokens).toBe(10);
		expect(h.controller.getSnapshot().history[0]?.turns[0]).toMatchObject({
			answer: "Partial",
			outcome: "failed",
		});
		expect(h.controller.getSnapshot().error?.code).toBe(
			"AGENT.HTTP.REQUEST.TIMEOUT",
		);
		h.controller.dispose();
	});

	it("continues the selected local session and clears only its local history", async () => {
		const history: ConversationHistory = {
			connectionId: "hermes",
			sessionId: "existing",
			turns: [
				{
					requestId: "old",
					text: "Earlier",
					answer: "Earlier answer",
					outcome: "completed",
				},
			],
		};
		const h = harness(async (command) =>
			command.type === "history"
				? {
						_tag: "success",
						history: [history, { ...history, connectionId: "other" }],
					}
				: success(),
		);
		await tick();
		expect(h.controller.getSnapshot().history).toEqual([history]);
		h.controller.selectSession("existing");
		await h.controller.send("Continue");
		expect(h.request).toHaveBeenCalledWith({
			type: "start",
			connectionId: "hermes",
			sessionId: "existing",
			requestId: "request-1",
			text: "Continue",
		});
		await h.controller.cancel();
		await h.controller.clear();
		expect(h.request).toHaveBeenCalledWith({
			type: "clear",
			connectionId: "hermes",
			sessionId: "existing",
		});
		expect(h.controller.getSnapshot().history).toEqual([]);
		expect(h.controller.getSnapshot().sessionId).toBeUndefined();
		h.controller.dispose();
	});

	it("doesn't create a phantom session when start is rejected", async () => {
		const h = harness(async (command) =>
			command.type === "start"
				? {
						_tag: "rejected",
						code: "AGENT.HTTP.CONNECTION.INVALID",
						message: "Connection changed",
					}
				: success(),
		);
		await tick();
		expect(await h.controller.send("Hello")).toBe(false);
		expect(h.controller.getSnapshot().history).toEqual([]);
		expect(h.controller.getSnapshot().sessionId).toBeUndefined();
		expect(h.controller.getSnapshot().error?.code).toBe(
			"AGENT.HTTP.CONNECTION.INVALID",
		);
		h.controller.dispose();
	});

	it("cancels on unmount and ignores the old start reply", async () => {
		const start = deferred<ConversationReply>();
		const h = harness(async (command) =>
			command.type === "start" ? start.promise : success(),
		);
		await tick();
		const sending = h.controller.send("Hello");
		h.controller.dispose();
		const snapshot = h.controller.getSnapshot();
		h.event(h.delta(0, "late"));
		start.resolve(success());
		expect(await sending).toBe(false);
		expect(h.controller.getSnapshot()).toBe(snapshot);
		expect(h.request).toHaveBeenCalledWith({
			type: "cancel",
			requestId: "request-1",
		});
		expect(h.off).toHaveBeenCalledOnce();
	});

	it("keeps exception diagnostics out of user-facing state and attempts cancellation after an uncertain start", async () => {
		const h = harness(async (command) => {
			if (command.type === "start")
				throw new Error("private token in raw IPC error");
			return success();
		});
		await tick();
		expect(await h.controller.send("Hello")).toBe(false);
		expect(h.controller.getSnapshot().error?.code).toBe(
			"AGENT.HTTP.REQUEST.FAILED",
		);
		expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
			"private token",
		);
		expect(h.request).toHaveBeenCalledWith({
			type: "cancel",
			requestId: "request-1",
		});
		h.controller.dispose();
	});
});

import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { expect, it } from "vitest";
import {
	ConversationRuntimePort,
	ConversationService,
} from "../../../../../../../packages/edge/src/agent-http/conversation-service";
import type {
	RuntimeConversationEvent,
	RuntimeConversationRequest,
} from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import { RuntimeCapabilityUnsupported } from "../../../../../../../packages/edge/src/agent-http/runtime-errors";
import type { RuntimeProviderAdapter } from "../../../../../../../packages/edge/src/agent-http/runtime-ports";
import { createConversationController as createMainController } from "../../../../main/agent-http/conversation-controller";
import { createAgentConversationsBridge } from "../../../../main/agent-http/conversation-preload";
import { createConversationController } from "./conversation-controller";

it("streams and cancels through the actual UI controller, preload acknowledgements, main authorization and scoped service", async () => {
	const inputs: RuntimeConversationRequest[] = [];
	const adapter: RuntimeProviderAdapter = {
		kind: "hermes",
		health: () =>
			Effect.succeed({ status: "ready", lifecycle: "externallyManaged" }),
		capabilities: () =>
			Effect.succeed({
				health: "supported",
				chat: "supported",
				listAgents: "unsupported",
				sessions: "unsupported",
				resources: "unsupported",
				models: "unsupported",
				toolEvents: "unsupported",
				usage: "unsupported",
			}),
		listAgents: () => Effect.fail(new RuntimeCapabilityUnsupported()),
		streamConversation: (_connection, input) => {
			inputs.push(input);
			return input.messages.at(-1)?.content === "wait"
				? Stream.concat(
						Stream.make({
							_tag: "textDelta" as const,
							kind: "generation" as const,
							textDelta: "partial",
						}),
						Stream.never,
					)
				: Stream.fromIterable<RuntimeConversationEvent>([
						{ _tag: "textDelta", kind: "generation", textDelta: "Hello " },
						{ _tag: "textDelta", kind: "generation", textDelta: "from Hermes" },
						{ _tag: "completed" },
					]);
		},
	};
	const runtime = ManagedRuntime.make(
		ConversationService.Default.pipe(
			Layer.provide(
				Layer.succeed(ConversationRuntimePort, {
					resolve: () =>
						Effect.succeed({
							connection: {
								id: "hermes",
								name: "Hermes fixture",
								kind: "hermes",
								baseURL: "http://localhost:8000/",
							},
							adapter,
						}),
				}),
			),
		),
	);
	const renderer = "file:///fixture/index.html";
	const source = { senderId: 42, mainFrame: true, frameURL: renderer };
	const listeners = new Set<(event: unknown, input: unknown) => void>();
	const main = createMainController({
		runtime,
		managementId: () => 42,
		renderer,
		send: (_source, event) => {
			for (const listener of listeners) listener(undefined, event);
			return true;
		},
	});
	const bridge = createAgentConversationsBridge({
		invoke: (_channel, input) => main.handle(source, input),
		on: (_channel, listener) => {
			listeners.add(listener);
		},
		removeListener: (_channel, listener) => {
			listeners.delete(listener);
		},
	});
	let serial = 0;
	const ui = createConversationController(
		bridge,
		{ connectionId: "hermes" },
		() => `turn-${++serial}`,
	);
	const until = async (condition: () => boolean) => {
		for (let attempt = 0; attempt < 100 && !condition(); attempt++)
			await new Promise<void>((resolve) => setTimeout(resolve, 5));
		expect(condition()).toBe(true);
	};
	try {
		ui.start();
		await until(() => ui.getSnapshot().pending === undefined);
		expect(await ui.send("hello")).toBe(true);
		await until(() => !ui.getSnapshot().active);
		expect(ui.getSnapshot().history[0]?.turns[0]).toMatchObject({
			answer: "Hello from Hermes",
			outcome: "completed",
		});
		expect(inputs[0]?.agentId).toBeUndefined();
		expect(inputs[0]?.sessionId).toBeUndefined();
		expect(await ui.send("wait")).toBe(true);
		await until(
			() => ui.getSnapshot().history[0]?.turns[1]?.answer === "partial",
		);
		await ui.cancel();
		expect(ui.getSnapshot().history[0]?.turns[1]?.outcome).toBe("cancelled");
		await ui.refresh();
		expect(ui.getSnapshot().history[0]?.turns[1]).toMatchObject({
			answer: "partial",
			outcome: "cancelled",
		});
		await ui.clear();
		expect(ui.getSnapshot().history).toEqual([]);
	} finally {
		ui.dispose();
		await main.dispose();
		await runtime.dispose();
	}
});

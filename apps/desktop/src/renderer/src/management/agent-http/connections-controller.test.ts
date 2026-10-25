import { describe, expect, it, vi } from "vitest";
import type { RuntimeCapabilities } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import type {
	AgentConnectionCommand,
	AgentConnectionReply,
	AgentConnectionsBridge,
	AgentConnectionView,
} from "../../../../shared/agent-connections";
import { createConnectionsController } from "./connections-controller";

const view: AgentConnectionView = {
	revision: 1,
	connections: [
		{
			id: "hermes",
			name: "Hermes on this device",
			kind: "hermes",
			baseURL: "http://localhost:8000/",
			credentialAvailable: true,
		},
	],
	selected: { connectionId: "hermes" },
	cleanupPending: false,
};
const capabilities: RuntimeCapabilities = {
	health: "supported",
	chat: "supported",
	listAgents: "unsupported",
	sessions: "unverified",
	resources: "unsupported",
	models: "supported",
	toolEvents: "unverified",
	usage: "unverified",
};
const success = (next = view): AgentConnectionReply => ({
	_tag: "success",
	view: next,
});
const tick = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
function harness(
	respond: (
		command: AgentConnectionCommand,
	) => Promise<AgentConnectionReply> = async () => success(),
) {
	let receive: ((view: AgentConnectionView) => void) | undefined;
	const off = vi.fn();
	const request = vi.fn(respond);
	const bridge: AgentConnectionsBridge = {
		request,
		onSnapshot: (callback) => {
			receive = callback;
			return off;
		},
	};
	const controller = createConnectionsController(bridge);
	controller.start();
	return {
		controller,
		request,
		off,
		snapshot: (next: AgentConnectionView) => receive?.(next),
	};
}

describe("runtime connection UI controller", () => {
	it("retains finite capability statuses without fabricating an agent catalog", async () => {
		const h = harness(async (command) =>
			command.type === "discover"
				? {
						...success(),
						_tag: "success",
						view,
						discovery: { capabilities, agents: [] },
					}
				: success(),
		);
		await tick();
		await h.controller.request({ type: "discover", id: "hermes" });
		expect(h.controller.getSnapshot().discovery.hermes).toEqual({
			capabilities,
			agents: [],
		});
		expect(h.controller.getSnapshot().health.hermes).toBeUndefined();
		h.controller.dispose();
	});

	it("forgets health and capabilities on a new configuration revision, including an opaque token replacement", async () => {
		const h = harness(async (command) =>
			command.type === "discover"
				? { _tag: "success", view, discovery: { capabilities, agents: [] } }
				: command.type === "test"
					? {
							_tag: "success",
							view,
							health: { status: "ready", lifecycle: "externallyManaged" },
						}
					: success(),
		);
		await tick();
		await h.controller.request({ type: "test", id: "hermes" });
		await h.controller.request({ type: "discover", id: "hermes" });
		expect(h.controller.getSnapshot().health.hermes?.status).toBe("ready");
		h.snapshot({ ...view, revision: 2 });
		expect(h.controller.getSnapshot().health).toEqual({});
		expect(h.controller.getSnapshot().discovery).toEqual({});
		h.snapshot(view);
		expect(h.controller.getSnapshot().view?.revision).toBe(2);
		h.controller.dispose();
	});

	it("doesn't attach an old health result to a connection edited while the check was in flight", async () => {
		let finish: (reply: AgentConnectionReply) => void = () => {};
		const pending = new Promise<AgentConnectionReply>((resolve) => {
			finish = resolve;
		});
		const h = harness(async (command) =>
			command.type === "test" ? pending : success(),
		);
		await tick();
		const checking = h.controller.request({ type: "test", id: "hermes" });
		h.snapshot({
			...view,
			revision: 2,
			connections: view.connections.map((connection) => ({
				...connection,
				baseURL: "http://another-host:8000/",
			})),
		});
		finish({
			_tag: "success",
			view,
			health: { status: "ready", lifecycle: "externallyManaged" },
		});
		await checking;
		expect(h.controller.getSnapshot().view?.connections[0]?.baseURL).toBe(
			"http://another-host:8000/",
		);
		expect(h.controller.getSnapshot().health).toEqual({});
		h.controller.dispose();
	});

	it("keeps plaintext credentials and raw IPC exception details out of view state", async () => {
		let reject = false;
		const h = harness(async () => {
			if (reject) throw new Error("raw private transport payload");
			return success();
		});
		await tick();
		await h.controller.request({
			type: "save",
			id: "hermes",
			name: "Hermes",
			kind: "hermes",
			baseURL: "http://localhost:8000/",
			credential: "synthetic-private-token",
		});
		expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
			"synthetic-private-token",
		);
		reject = true;
		await h.controller.request({ type: "list" });
		expect(h.controller.getSnapshot().error?.code).toBe(
			"AGENT.HTTP.REQUEST.FAILED",
		);
		expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
			"raw private",
		);
		h.controller.dismissError();
		expect(h.controller.getSnapshot().error).toBeUndefined();
		h.controller.dispose();
	});

	it("ignores an old mount's reply after cleanup and retries the new mount", async () => {
		let finish: (reply: AgentConnectionReply) => void = () => {};
		const pending = new Promise<AgentConnectionReply>((resolve) => {
			finish = resolve;
		});
		let calls = 0;
		const h = harness(async () =>
			++calls === 1 ? pending : success({ ...view, revision: 2 }),
		);
		h.controller.dispose();
		h.controller.start();
		await tick();
		finish(success());
		await tick();
		expect(h.controller.getSnapshot().view?.revision).toBe(2);
		expect(h.controller.getSnapshot().busy).toBe(false);
		expect(h.off).toHaveBeenCalledOnce();
		h.controller.dispose();
	});
});

it("keeps save plus selected connection atomic against automatic discovery", async () => {
	const added = {
		id: "openclaw",
		name: "New OpenClaw",
		kind: "openclaw" as const,
		baseURL: "http://localhost:18789/",
		credentialAvailable: true,
	};
	const saved = {
		...view,
		revision: 2,
		connections: [...view.connections, added],
	};
	const selected = {
		...saved,
		revision: 3,
		selected: { connectionId: added.id },
	};
	const h = harness(async (command) =>
		command.type === "save"
			? success(saved)
			: command.type === "select"
				? success(selected)
				: success(),
	);
	await tick();
	let discoveryAttempted = false;
	const off = h.controller.subscribe(() => {
		const state = h.controller.getSnapshot();
		if (state.view?.revision === 2 && !state.busy && !discoveryAttempted) {
			discoveryAttempted = true;
			void h.controller.request({ type: "discover", id: "hermes" });
		}
	});
	try {
		await h.controller.saveAndSelect({
			type: "save",
			name: added.name,
			kind: added.kind,
			baseURL: added.baseURL,
		});
		expect(h.controller.getSnapshot().view?.selected?.connectionId).toBe(
			"openclaw",
		);
		expect(h.request.mock.calls.map(([command]) => command.type)).toEqual([
			"list",
			"save",
			"select",
		]);
		expect(discoveryAttempted).toBe(false);
	} finally {
		off();
		h.controller.dispose();
	}
});

it("keeps a completed save when follow-up selection throws so the form won't duplicate it", async () => {
	const saved = {
		...view,
		revision: 2,
		connections: [
			...view.connections,
			{
				id: "new",
				name: "New",
				kind: "hermes" as const,
				baseURL: "http://localhost:8001/",
				credentialAvailable: false,
			},
		],
	};
	const h = harness(async (command) => {
		if (command.type === "select") throw new Error("private IPC detail");
		return success(command.type === "save" ? saved : view);
	});
	await tick();
	const reply = await h.controller.saveAndSelect({
		type: "save",
		name: "New",
		kind: "hermes",
		baseURL: "http://localhost:8001/",
		clearCredential: true,
	});
	expect(reply).toEqual(success(saved));
	expect(h.controller.getSnapshot().view).toEqual(saved);
	expect(h.controller.getSnapshot().busy).toBe(false);
	expect(h.controller.getSnapshot().error?.code).toBe(
		"AGENT.HTTP.REQUEST.FAILED",
	);
	expect(JSON.stringify(h.controller.getSnapshot())).not.toContain(
		"private IPC detail",
	);
	h.controller.dispose();
});

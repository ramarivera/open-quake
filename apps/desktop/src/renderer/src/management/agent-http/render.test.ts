import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentConversationsBridge } from "../../../../shared/agent-conversations";
import { AgentsPage } from "../agents/AgentsPage";
import { DirectChatPanel } from "../chat/DirectChatPanel";
import { ConnectionForm } from "./ConnectionForm";
import { ConversationPanel } from "./ConversationPanel";

afterEach(() => vi.unstubAllGlobals());

it("mounts the conversation workspace without waiting for the local workspace library to load", () => {
	vi.stubGlobal("window", {});
	const html = renderToStaticMarkup(createElement(AgentsPage));
	expect(html).toContain("Direct model");
	expect(html).toContain("Add connection");
	expect(html).toContain("Agent library");
	expect(html.match(/id="agents-sessions"/g)).toHaveLength(1);
	expect(html).not.toContain("Start OpenClaw");
	expect(html).toContain("Loading model settings");
	expect(html).not.toContain("Set up a model to chat");
	expect(html).not.toContain("No model set up");
});

it("reports a configuration read failure separately from an unconfigured model", () => {
	vi.stubGlobal("window", {});
	const html = renderToStaticMarkup(
		createElement(DirectChatPanel, {
			bridge: undefined,
			model: { ready: false, row: undefined },
			configurationError: "Settings could not be read",
			onRetryConfiguration: () => {},
		}),
	);
	expect(html).toContain("Model settings couldn&#x27;t be read");
	expect(html).not.toContain("Set up a model to chat");
	expect(html).not.toContain("No model set up");
});

it("renders a masked, empty credential field when editing a credential-bearing connection", () => {
	const html = renderToStaticMarkup(
		createElement(ConnectionForm, {
			existing: {
				id: "saved",
				name: "Saved runtime",
				kind: "hermes",
				baseURL: "http://localhost:8000/",
				credentialAvailable: true,
			},
			busy: false,
			onSave: async () => true,
			onCancel: () => {},
		}),
	);
	expect(html).toMatch(/type="password"[^>]*value=""/);
	expect(html).toContain("Remove the saved credential");
	expect(html).not.toContain('type="text" value="saved');
});

it("disables chat for an unsupported endpoint even when the conversation bridge exists", () => {
	const bridge: AgentConversationsBridge = {
		request: async () => ({ _tag: "success", history: [] }),
		onEvent: () => () => {},
	};
	const html = renderToStaticMarkup(
		createElement(ConversationPanel, {
			connection: {
				id: "saved",
				name: "Saved runtime",
				kind: "hermes",
				baseURL: "http://localhost:8000/",
				credentialAvailable: false,
			},
			discovery: {
				capabilities: {
					health: "supported",
					chat: "unsupported",
					listAgents: "unsupported",
					sessions: "unsupported",
					resources: "unsupported",
					models: "unsupported",
					toolEvents: "unsupported",
					usage: "unsupported",
				},
				agents: [],
			},
			agentId: undefined,
			bridge,
			selectionBusy: false,
			onAgentChange: () => {},
			onRunningChange: () => {},
		}),
	);
	expect(html).toContain("doesn&#x27;t support conversations");
	expect(html).toMatch(/<textarea[^>]*disabled/);
	expect(html).not.toContain("Remote agent ID");
	expect(html).not.toContain("Start Hermes");
});

it("offers discovered Hermes model routes without advertising backend model selection for OpenClaw", () => {
	for (const kind of ["hermes", "openclaw"] as const) {
		const html = renderToStaticMarkup(
			createElement(ConversationPanel, {
				connection: {
					id: "saved",
					name: "Runtime",
					kind,
					baseURL: "http://localhost:8000/",
					credentialAvailable: false,
				},
				discovery: {
					capabilities: {
						health: "supported",
						chat: "supported",
						listAgents: "unsupported",
						sessions: "unsupported",
						resources: "unsupported",
						models: "supported",
						toolEvents: "unsupported",
						usage: "unsupported",
					},
					agents: [],
					models: [{ id: "fast", name: "Fast route" }],
				},
				agentId: undefined,
				bridge: undefined,
				selectionBusy: false,
				onAgentChange: () => {},
				onRunningChange: () => {},
			}),
		);
		if (kind === "hermes") {
			expect(html).toContain("Model route");
			expect(html).toContain('value="fast"');
			expect(html).toContain("Fast route");
		} else expect(html).not.toContain("Model route");
	}
});

it("folds the runtime address, test, route and actions behind one Details disclosure", () => {
	const panel = (agentId: string | undefined) =>
		renderToStaticMarkup(
			createElement(ConversationPanel, {
				connection: {
					id: "saved",
					name: "Studio",
					kind: "openclaw",
					baseURL: "http://localhost:8000/",
					credentialAvailable: false,
				},
				discovery: {
					capabilities: {
						health: "supported",
						chat: "supported",
						listAgents: "supported",
						sessions: "unsupported",
						resources: "unsupported",
						models: "unsupported",
						toolEvents: "unsupported",
						usage: "unsupported",
					},
					agents: [{ id: "ops", name: "Operations" }],
				},
				health: { status: "ready" } as never,
				agentId,
				bridge: undefined,
				selectionBusy: false,
				onTest: () => {},
				onOpenConnection: () => {},
				onAgentChange: () => {},
				onRunningChange: () => {},
			}),
		);
	const html = panel(undefined);
	const toggle = html.match(/<button[^>]*cw-details-toggle[^>]*>/)?.[0] ?? "";
	expect(toggle).toContain('aria-expanded="false"');
	const controls = toggle.match(/aria-controls="([^"]+)"/)?.[1]?.split(" ");
	expect(controls).toHaveLength(4);
	for (const id of controls ?? []) expect(html).toContain(`id="${id}"`);
	expect(html).toMatch(/cw-details-toggle[^>]*>Details</);
	// Name and health stay outside the fold, before the disclosure.
	expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("Details<"));
	expect(html.indexOf("Details<")).toBeLessThan(
		html.indexOf("Test connection"),
	);
	expect(html).not.toContain("cw-route-summary");
	// A chosen route stays named in the folded row.
	expect(panel("ops")).toMatch(/cw-route-summary">Operations</);
});

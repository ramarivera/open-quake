import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentConversationsBridge } from "../../../../shared/agent-conversations";
import { AgentsPage } from "../agents/AgentsPage";
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

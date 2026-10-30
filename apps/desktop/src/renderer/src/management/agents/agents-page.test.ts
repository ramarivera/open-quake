// @vitest-environment happy-dom

import { Schema } from "effect";
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import {
	AgentId,
	type AgentsBridge,
	type AgentView,
} from "../../../../shared/agents";
import { button, click, element, input, mount } from "../dom-test";
import { AgentsPage } from "./AgentsPage";
import { ModelsPanel } from "./ModelsPanel";
import { SkillsPanel } from "./SkillsPanel";
import type { AgentRequest } from "./useAgents";

const main = Schema.decodeUnknownSync(AgentId)("main");
const researcher = Schema.decodeUnknownSync(AgentId)("researcher");
const view: AgentView = {
	revision: 7,
	agents: [
		{ id: main, name: "Main", emoji: "", files: {} },
		{ id: researcher, name: "Researcher", emoji: "", files: {} },
	],
	skills: [
		{
			folder: "web-search",
			name: "Web search",
			owner: "researcher",
			description: "Cite evidence",
			content:
				"---\nname: Web search\ndescription: Cite evidence\n---\nFind sources.",
		},
	],
	models: {
		default: [
			{
				id: "model",
				provider: "",
				model: "",
				baseUrl: "",
				maxTokens: 17,
				role: "none",
				credentialAvailable: false,
			},
		],
	},
	slots: { "1,5": main, "1,6": main, "2,5": main, "2,6": main },
	runtime: {
		available: false,
		status: "stopped",
		code: "AGENT.RUNTIME.UNAVAILABLE",
		operation: "none",
	},
	progress: { percent: 0, stage: "idle", deviceApplied: false },
	draftingAvailable: false,
};

it("CENTER-019 keeps agent search, model draft and slot edits across all four real panels", async () => {
	const bridge: AgentsBridge = {
		request: vi.fn<AgentRequest>(async () => ({
			_tag: "success",
			view,
			draft: "",
		})),
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	};
	await mount(createElement(AgentsPage, { bridge }));
	const sessionsToggle = element<HTMLElement>(
		"#agents-sessions .cw-list-toggle",
	);
	await click(sessionsToggle);
	expect(sessionsToggle.getAttribute("aria-expanded")).toBe("true");
	await click(element("#agents-tab-agents"));
	const search = element<HTMLInputElement>("#agents-agents input[type=search]");
	await input(search, "Research");
	await click(element("#agents-tab-ai"));
	const model = element<HTMLInputElement>(
		"#agents-ai input[list^=agent-models]",
	);
	await input(model, "unsaved-model");
	await click(element("#agents-tab-settings"));
	const slot = element<HTMLSelectElement>('select[aria-label="Agent 1,5"]');
	await input(slot, "researcher");
	await click(element("#agents-tab-sessions"));
	// The unconfigured sessions panel offers model configuration. This interaction
	// changes its selected panel through the real session consumer.
	await click(button("Model settings", element("#agents-sessions")));
	expect(element("#agents-tab-ai").getAttribute("aria-selected")).toBe("true");
	expect(
		element<HTMLInputElement>("#agents-ai input[list^=agent-models]"),
	).toBe(model);
	expect(model.value).toBe("unsaved-model");
	await click(element("#agents-tab-agents"));
	expect(search.value).toBe("Research");
	await click(element("#agents-tab-settings"));
	expect(slot.value).toBe("researcher");
	await act(async () =>
		element("#agents-tab-settings").dispatchEvent(
			new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
		),
	);
	expect(element("#agents-tab-sessions").getAttribute("aria-selected")).toBe(
		"true",
	);
	expect(element("#agents-sessions .cw-list-toggle")).toBe(sessionsToggle);
	expect(sessionsToggle.getAttribute("aria-expanded")).toBe("true");
	expect(element<HTMLElement>("#agents-settings").hidden).toBe(true);
});

it("CENTER-053/060 searches metadata, validates edits, retains failed saves and confirms deletion", async () => {
	const request: AgentRequest = vi.fn<AgentRequest>(async () => ({
		_tag: "rejected",
		code: "AGENT.SKILL.CONFLICT",
		message: "Conflict",
	}));
	await mount(createElement(SkillsPanel, { view, request, busy: false }));
	const search = element<HTMLInputElement>("input[type=search]");
	for (const term of [
		"Web search",
		"web-search",
		"Cite evidence",
		"Researcher",
		"researcher",
	]) {
		await input(search, term);
		expect(document.querySelectorAll(".aw-skill-list > li")).toHaveLength(1);
	}
	await input(search, "no-such-skill");
	expect(document.querySelectorAll(".aw-skill-list > li")).toHaveLength(0);
	await input(search, "");
	await click(button("Edit"));
	const name = element<HTMLInputElement>("dialog input");
	const content = element<HTMLTextAreaElement>("dialog textarea[rows='18']");
	await input(name, "");
	expect(button("Save skill").disabled).toBe(true);
	await input(name, "New skill");
	await input(content, "");
	expect(button("Save skill").disabled).toBe(true);
	const markdown =
		"---\nname: New skill\ndescription: New description\n---\nNew content.";
	await input(content, markdown);
	await click(button("Save skill"));
	expect(request).toHaveBeenCalledWith({
		type: "save-skill",
		create: false,
		folder: "web-search",
		owner: "researcher",
		name: "New skill",
		content: markdown,
		revision: 7,
	});
	expect(content.value).toBe(markdown);
	expect(document.querySelector("dialog")).not.toBeNull();
	expect(element("dialog [role=alert]").textContent).toMatch(
		/already|exists|conflict/i,
	);
	await click(button("Cancel", element("dialog")));
	await click(button("Move back to common"));
	expect(document.body.textContent).toMatch(/already|exists|conflict/i);
	await click(button("Delete"));
	expect(request).not.toHaveBeenCalledWith(
		expect.objectContaining({ type: "delete-skill" }),
	);
	await click(button("Cancel", element("dialog")));
	expect(document.querySelector("dialog")).toBeNull();
	await click(button("Delete"));
	await click(element("dialog button[data-variant=danger]"));
	expect(request).toHaveBeenCalledWith({
		type: "delete-skill",
		folder: "web-search",
		owner: "researcher",
		revision: 7,
		confirmed: true,
	});
});

it("CENTER-070 autofills catalog provider/model/token suggestions and preserves a custom endpoint", async () => {
	const request: AgentRequest = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: "",
	}));
	await mount(createElement(ModelsPanel, { view, request, busy: false }));
	const provider = element<HTMLInputElement>("input[list^=agent-providers]");
	const model = element<HTMLInputElement>("input[list^=agent-models]");
	const url = element<HTMLInputElement>("input[type=url]");
	expect(
		[
			...element("datalist[id^=agent-providers]").querySelectorAll("option"),
		].map((option) => option.value),
	).toEqual([
		"openai",
		"azure",
		"anthropic",
		"gemini",
		"google",
		"moonshot",
		"codex",
		"openai-codex",
		"minimax",
		"kimi",
		"kimi-coding",
		"deepseek",
		"qwen",
		"custom",
		"groq",
		"zhipu",
		"xfy",
		"volc",
		"coze",
	]);
	await input(provider, "deepseek");
	expect(url.value).toBe("https://api.deepseek.com");
	expect(
		[...element("datalist[id^=agent-models]").querySelectorAll("option")].map(
			(option) => option.value,
		),
	).toEqual([
		"deepseek-v4-flash",
		"deepseek-v4-pro",
		"deepseek-chat",
		"deepseek-reasoner",
	]);
	await input(url, "");
	await input(model, "gpt-4o-mini");
	expect(provider.value).toBe("openai");
	expect(url.value).toBe("https://api.openai.com/v1");
	expect(
		element<HTMLInputElement>('input[aria-label^="Max tokens"]').value,
	).toBe("4096");
	await input(url, "https://custom.example/v1");
	await input(model, "deepseek-chat");
	expect(provider.value).toBe("deepseek");
	expect(url.value).toBe("https://custom.example/v1");
});

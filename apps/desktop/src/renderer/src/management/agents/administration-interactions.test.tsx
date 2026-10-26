// @vitest-environment happy-dom
import { Schema } from "effect";
import { act, useState } from "react";
import { expect, it, vi } from "vitest";
import { initialAgentState } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import {
	AgentId,
	type AgentsBridge,
	type AgentView,
} from "../../../../shared/agents";
import { AppLocaleProvider } from "../../i18n";
import { button, click, element, input, mount } from "../dom-test";
import { AdministrationPanel } from "./AdministrationPanel";
import { AgentsPage } from "./AgentsPage";
import { AgentWizard } from "./AgentWizard";
import { ModelsPanel } from "./ModelsPanel";
import { SkillsPanel } from "./SkillsPanel";
import { SKILL_DRAG_TYPE } from "./skill-transfer";
import type { AgentRequest } from "./useAgents";

const writer = Schema.decodeUnknownSync(AgentId)("writer");
const view: AgentView = {
	...initialAgentState(),
	agents: [
		...initialAgentState().agents,
		{ id: writer, name: "Writer", emoji: "", files: {} },
	],
	skills: [
		{
			owner: "",
			folder: "search",
			name: "Search",
			description: "Find sources",
			content: "---\nname: Search\n---\nSearch",
		},
		{
			owner: "writer",
			folder: "draft",
			name: "Draft",
			description: "Write",
			content: "---\nname: Draft\n---\nWrite",
		},
	],
	models: {
		default: [
			{
				id: "model",
				provider: "openai",
				model: "fake-model",
				baseUrl: "",
				maxTokens: 17,
				role: "default",
				credentialAvailable: false,
			},
		],
	},
	runtime: { available: true, status: "stopped", operation: "none", code: "" },
	progress: { percent: 0, stage: "idle", deviceApplied: false },
	draftingAvailable: false,
};
const settings = {
	port: 18789,
	logLevel: "info",
	autoStart: false,
	dataDirectory: "/private/runtime",
};
it("CENTER-047/048 initial Settings load, channel invalidation and explicit clear cancellation use the real consumer", async () => {
	const request = vi.fn<AgentRequest>(async (command) => ({
		_tag: "success",
		view,
		draft: command.type === "service-settings" ? JSON.stringify(settings) : "",
	}));
	const bridge: AgentsBridge = {
		request,
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	};
	await mount(<AgentsPage initialTab="settings" bridge={bridge} />);
	expect(
		request.mock.calls.filter(([c]) => c.type === "service-settings"),
	).toHaveLength(1);
	const before = request.mock.calls.filter(([c]) => c.type === "read").length;
	await act(async () =>
		window.dispatchEvent(new Event("agents:settings-invalidated")),
	);
	expect(request.mock.calls.filter(([c]) => c.type === "read")).toHaveLength(
		before + 1,
	);
	await input(
		element<HTMLInputElement>("#agents-settings input[type=number]"),
		"19001",
	);
	await click(button("Save Settings"));
	expect(request).toHaveBeenCalledWith({
		type: "save-service-settings",
		settings: { ...settings, port: 19001 },
		restart: false,
		revision: view.revision,
	});
	expect(document.body.textContent).toContain("Settings saved.");
	await click(button("Clear runtime data"));
	await click(button("Cancel", element("[role=alertdialog]")));
	expect(
		request.mock.calls.some(([c]) => c.type === "clear-runtime-data"),
	).toBe(false);
	await click(button("Clear runtime data"));
	await click(button("Confirm clear"));
	expect(request).toHaveBeenCalledWith({
		type: "clear-runtime-data",
		confirmed: true,
		revision: view.revision,
	});
});
it("CENTER-047 external process settings remain unavailable while portable operations remain usable", async () => {
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "rejected",
		code: "AGENT.RUNTIME.UNAVAILABLE",
		message: "Unsupported",
	}));
	await mount(
		<AdministrationPanel
			view={{ ...view, runtime: { ...view.runtime, available: false } }}
			request={request}
			busy={false}
		/>,
	);
	expect(document.querySelector("input[type=number]")).toBeNull();
	expect(request).not.toHaveBeenCalled();
	await click(button("Export pack"));
	expect(request).toHaveBeenCalledWith({ type: "export-pack", id: "writer" });
});
it("CENTER-049/055 grid/list, roster search/clear, protected main and deleted selection fallback stay coherent", async () => {
	let publish: (next: AgentView) => void = () => {};
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: "",
	}));
	await mount(
		<AgentsPage
			initialTab="agents"
			bridge={{
				request,
				onSnapshot: (listener) => {
					publish = listener;
					return () => {};
				},
				onProgress: () => () => {},
			}}
		/>,
	);
	const roster = element("#agents-agents .aw-rows");
	expect(roster.getAttribute("data-layout")).toBe("grid");
	await click(button("List"));
	expect(roster.getAttribute("data-layout")).toBe("list");
	expect(document.querySelector('[aria-label="Delete Agent Main"]')).toBeNull();
	await input(
		element<HTMLInputElement>("#agents-agents input[type=search]"),
		"missing",
	);
	expect(roster.children).toHaveLength(0);
	await click(button("Clear search"));
	expect(roster.children).toHaveLength(2);
	await click(button("Local", element("#agents-agents .aw-list-tools")));
	expect(roster.children).toHaveLength(1);
	await click(element("#agents-agents .aw-row-main"));
	expect(element(".aw-detail h3").textContent).toBe("Writer");
	await act(async () =>
		publish({
			...view,
			revision: view.revision + 1,
			agents: view.agents.filter((a) => a.id !== writer),
		}),
	);
	expect(element(".aw-detail h3").textContent).toBe("Main");
});
it("CENTER-049/052 drop dispatches an atomic move; invalid drops do nothing and scope filters preserve direct transfer", async () => {
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: "",
	}));
	const mounted = await mount(
		<AgentsPage
			initialTab="agents"
			bridge={{
				request,
				onSnapshot: () => () => {},
				onProgress: () => () => {},
			}}
		/>,
	);
	const rows = element("#agents-agents .aw-rows").children;
	const target = rows[1];
	if (!target) throw new Error("Missing writer");
	const drop = async (payload: string) => {
		const dataTransfer = new DataTransfer();
		dataTransfer.setData(SKILL_DRAG_TYPE, payload);
		const event = new Event("drop", { bubbles: true });
		Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
		await act(async () => target.dispatchEvent(event));
	};
	request.mockClear();
	await drop("{");
	expect(request).not.toHaveBeenCalled();
	await drop(JSON.stringify({ owner: "", folder: "missing" }));
	expect(request).not.toHaveBeenCalled();
	await drop(JSON.stringify({ owner: "", folder: "search" }));
	expect(request).toHaveBeenCalledWith({
		type: "move-skill",
		owner: "",
		folder: "search",
		target: "writer",
		revision: view.revision,
	});
	await mounted.unmount();
	await mount(<SkillsPanel view={view} request={request} busy={false} />);
	const scope = element<HTMLSelectElement>('select[aria-label="Skill scope"]');
	await input(scope, "shared");
	expect(element(".aw-skill-list").children).toHaveLength(1);
	expect(element(".aw-skill-list").textContent).toContain("Search");
	await input(scope, "agent");
	expect(element(".aw-skill-list").textContent).toContain("Draft");
	await input(scope, "all");
	expect(element(".aw-skill-list").children).toHaveLength(2);
});
it("CENTER-065 model loading and failed/successful save feedback support reload without cloud calls", async () => {
	let failed = true;
	const request = vi.fn<AgentRequest>(async () =>
		failed
			? {
					_tag: "rejected",
					code: "AGENT.STORAGE.FAILED",
					message: "Save failed",
				}
			: { _tag: "success", view, draft: "" },
	);
	const loading = await mount(
		<ModelsPanel view={view} request={request} busy />,
	);
	expect(document.body.textContent).toContain(
		"Loading local model configuration",
	);
	await loading.unmount();
	await mount(<ModelsPanel view={view} request={request} busy={false} />);
	await click(button("Save"));
	expect(document.body.textContent).toContain("Save failed");
	failed = false;
	await click(button("Save"));
	expect(document.body.textContent).toContain(
		"Model configuration saved locally.",
	);
	await click(button("Reload local configuration"));
	expect(request).toHaveBeenLastCalledWith({ type: "read" });
});
it("CENTER-050 edit name saves with revision and template-reset cancellation and failure retain the draft", async () => {
	const edited = {
		...view,
		agents: view.agents.map((a) =>
			a.id === writer ? { ...a, files: { "SOUL.md": "Keep my edits" } } : a,
		),
	};
	const request = vi.fn<AgentRequest>(async (command) =>
		command.type === "reset-templates"
			? {
					_tag: "rejected",
					code: "AGENT.STORAGE.FAILED",
					message: "Disk failed",
				}
			: { _tag: "success", view: edited, draft: "" },
	);
	await mount(
		<AgentsPage
			initialTab="agents"
			bridge={{
				request,
				onSnapshot: () => () => {},
				onProgress: () => () => {},
			}}
		/>,
	);
	const edit = document.querySelector<HTMLButtonElement>(
		'button[aria-label="Edit agent Writer"]',
	);
	if (!edit) throw new Error("Missing edit");
	await click(edit);
	await input(
		element<HTMLInputElement>('dialog input[aria-label="Display name"]'),
		"Author",
	);
	await act(async () =>
		element('dialog input[aria-label="Display name"]').dispatchEvent(
			new FocusEvent("focusout", { bubbles: true }),
		),
	);
	expect(request).toHaveBeenCalledWith({
		type: "rename",
		id: "writer",
		name: "Author",
		revision: view.revision,
	});
	await click(button("Reset templates"));
	await click(button("Cancel", element("[role=alertdialog]")));
	expect(request.mock.calls.some(([c]) => c.type === "reset-templates")).toBe(
		false,
	);
	await click(button("Reset templates"));
	await click(button("Reset", element("[role=alertdialog]")));
	expect(request).toHaveBeenCalledWith({
		type: "reset-templates",
		id: "writer",
		confirmed: true,
		revision: view.revision,
	});
	expect(element('dialog textarea[rows="14"]').textContent).toBe(
		"Keep my edits",
	);
	expect(element("dialog [role=alert]").textContent).toContain("Disk failed");
});

it("CENTER-104 exports the authored workspace backup through the mounted settings consumer", async () => {
	const backup = JSON.stringify({
		version: 1,
		kind: "local-agent-workspaces",
		agents: view.agents,
	});
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: backup,
	}));
	await mount(
		<AdministrationPanel
			view={{ ...view, runtime: { ...view.runtime, available: false } }}
			request={request}
			busy={false}
		/>,
	);
	await click(button("Export workspace backup"));
	expect(request).toHaveBeenCalledWith({ type: "export-workspace-backup" });
	expect(element<HTMLTextAreaElement>("textarea[readonly]").value).toBe(backup);
});

it("CENTER-052 keeps a roster target visible beside a mounted skill drag source", async () => {
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: "",
	}));
	await mount(
		<AgentsPage
			initialTab="agents"
			bridge={{
				request,
				onSnapshot: () => () => {},
				onProgress: () => () => {},
			}}
		/>,
	);
	await click(button("Skill management"));
	const source = element<HTMLElement>(".aw-skill-list li[draggable]");
	const target = element<HTMLElement>(
		"#agents-agents .aw-rows li:nth-child(2)",
	);
	expect(source.closest("[hidden]")).toBeNull();
	expect(target.closest("[hidden]")).toBeNull();
	const dataTransfer = new DataTransfer();
	const drag = async (node: HTMLElement, type: string) => {
		const event = new Event(type, { bubbles: true, cancelable: true });
		Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
		await act(async () => node.dispatchEvent(event));
		return event;
	};
	request.mockClear();
	await drag(source, "dragstart");
	expect(dataTransfer.getData(SKILL_DRAG_TYPE)).toBe(
		JSON.stringify({ owner: "", folder: "search" }),
	);
	expect((await drag(target, "dragover")).defaultPrevented).toBe(true);
	await drag(target, "drop");
	expect(request).toHaveBeenCalledExactlyOnceWith({
		type: "move-skill",
		owner: "",
		folder: "search",
		target: "writer",
		revision: view.revision,
	});
});

it("CENTER-047 pack export follows the visible agent after roster replacement", async () => {
	let publish: (next: AgentView) => void = () => {};
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: "",
	}));
	function Panel() {
		const [current, setCurrent] = useState(view);
		publish = setCurrent;
		return (
			<AdministrationPanel view={current} request={request} busy={false} />
		);
	}
	await mount(<Panel />);
	const replacement = Schema.decodeUnknownSync(AgentId)("reviewer");
	await act(async () =>
		publish({
			...view,
			agents: [
				...view.agents.filter((a) => a.id === "main"),
				{ id: replacement, name: "Reviewer", emoji: "", files: {} },
			],
		}),
	);
	expect(element<HTMLSelectElement>("details select").value).toBe("reviewer");
	await click(button("Export pack"));
	expect(request).toHaveBeenLastCalledWith({
		type: "export-pack",
		id: "reviewer",
	});
	await act(async () =>
		publish({ ...view, agents: view.agents.filter((a) => a.id === "main") }),
	);
	expect(element<HTMLSelectElement>("details select").value).toBe("main");
	await click(button("Export pack"));
	expect(request).toHaveBeenLastCalledWith({ type: "export-pack", id: "main" });
});

it("CENTER-052 skill agent scope follows additions and deletions in the roster", async () => {
	let publish: (next: AgentView) => void = () => {};
	const request = vi.fn<AgentRequest>(async () => ({
		_tag: "success",
		view,
		draft: "",
	}));
	function Panel() {
		const [current, setCurrent] = useState<AgentView>({
			...view,
			agents: view.agents.filter((a) => a.id === "main"),
		});
		publish = setCurrent;
		return <SkillsPanel view={current} request={request} busy={false} />;
	}
	await mount(<Panel />);
	await input(
		element<HTMLSelectElement>('select[aria-label="Skill scope"]'),
		"agent",
	);
	expect(document.querySelectorAll(".aw-skill-list li")).toHaveLength(0);
	await act(async () => publish(view));
	expect(element<HTMLSelectElement>('select[aria-label="Agent"]').value).toBe(
		"writer",
	);
	expect(element(".aw-skill-list").textContent).toContain("Draft");
	const reviewer = Schema.decodeUnknownSync(AgentId)("reviewer");
	await act(async () =>
		publish({
			...view,
			agents: [
				...view.agents.filter((a) => a.id === "main"),
				{ id: reviewer, name: "Reviewer", emoji: "", files: {} },
			],
			skills: [
				...view.skills,
				{
					description: "Review drafts",
					content: "---\nname: Review\n---\nReview",
					owner: "reviewer",
					folder: "review",
					name: "Review",
				},
			],
		}),
	);
	expect(element<HTMLSelectElement>('select[aria-label="Agent"]').value).toBe(
		"reviewer",
	);
	expect(element(".aw-skill-list").textContent).toContain("Review");
	expect(element(".aw-skill-list").textContent).not.toContain("Draft");
	await act(async () =>
		publish({ ...view, agents: view.agents.filter((a) => a.id === "main") }),
	);
	expect(element<HTMLSelectElement>('select[aria-label="Agent"]').value).toBe(
		"",
	);
	expect(document.querySelectorAll(".aw-skill-list li")).toHaveLength(0);
});

it.each(["en", "de"] as const)(
	"CENTER-052 localizes the skill selector label and accessible name in %s",
	async (locale) => {
		const request = vi.fn<AgentRequest>(async () => ({
			_tag: "success",
			view,
			draft: "",
		}));
		await mount(
			<AppLocaleProvider initialLocale={locale} bridge={null}>
				<SkillsPanel view={view} request={request} busy={false} />
			</AppLocaleProvider>,
			false,
		);
		const scope = locale === "de" ? "Skill-Bereich" : "Skill scope";
		await input(
			element<HTMLSelectElement>(`select[aria-label="${scope}"]`),
			"agent",
		);
		const selector = element<HTMLSelectElement>('select[aria-label="Agent"]');
		expect(selector.labels?.[0]?.textContent?.trim().startsWith("Agent")).toBe(
			true,
		);
		expect(selector.value).toBe("writer");
		expect(document.querySelector('[aria-label="Skill agent"]')).toBeNull();
	},
);

it.each(["en", "de"] as const)(
	"CENTER-048 reset confirmation names the reset action in %s",
	async (locale) => {
		const request = vi.fn<AgentRequest>(async () => ({
			_tag: "success",
			view,
			draft: "",
		}));
		await mount(
			<AppLocaleProvider initialLocale={locale} bridge={null}>
				<AgentWizard
					agent={view.agents[1]}
					view={view}
					request={request}
					onClose={() => {}}
				/>
			</AppLocaleProvider>,
			false,
		);
		await click(
			button(locale === "de" ? "Vorlagen zurücksetzen" : "Reset templates"),
		);
		const confirmation = element("[role=alertdialog]");
		const action = button(
			locale === "de" ? "Zurücksetzen" : "Reset",
			confirmation,
		);
		expect(confirmation.textContent).not.toContain(
			locale === "de" ? "Löschen bestätigen" : "Confirm clear",
		);
		await click(action);
		expect(request).toHaveBeenCalledWith({
			type: "reset-templates",
			id: "writer",
			confirmed: true,
			revision: view.revision,
		});
	},
);

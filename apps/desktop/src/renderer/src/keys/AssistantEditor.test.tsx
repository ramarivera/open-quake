// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	KnobResource,
	type KnobSlot,
} from "../../../../../../packages/device/src/knob/knob-contracts";
import { defaultAssistantSettings } from "../../../../../../packages/device/src/profiles/assistant-contracts";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import { Agent } from "../../../../../../packages/edge/src/agents/agents-contracts";
import { initialAgentState } from "../../../../../../packages/edge/src/agents/agents-invariants";
import type {
	AgentInput,
	AgentView,
	PublicModelRow,
} from "../../../shared/agents";
import { button, click, input, mount, query, settle } from "../../test/dom";
import { AssistantProviderSettings } from "../maintenance/AssistantProviderSettings";
import { PersonaSettings } from "../management/agents/PersonaSettings";

import { fakeBridge, wizard } from "../settings/test-fixtures";
import { AssistantControls, AssistantEditor } from "./AssistantEditor";
import { AssistantLink } from "./AssistantLink";
import { KnobAssistantSettings } from "./KnobAssistantSettings";
import { KnobEditor } from "./KnobEditor";
import { knobAssignment } from "./knob-draft";

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0).reverse()) await close();
	vi.unstubAllGlobals();
});
const rows: readonly PublicModelRow[] = [
	"openai",
	"deepseek",
	"kimi",
	"qwen",
].map((provider, index) => ({
	id: provider,
	provider,
	model: provider === "qwen" ? "qwen3.6-plus" : `custom-${provider}`,
	role: index === 0 ? "default" : "fallback",
	baseUrl: "https://fake.invalid/v1",
	maxTokens: 512,
	credentialAvailable: true,
}));
const view = (models = rows): AgentView => ({
	...initialAgentState(),
	models: { default: models },
	runtime: { available: false, status: "stopped", code: "", operation: "none" },
	progress: { percent: 0, stage: "idle", deviceApplied: false },
	draftingAvailable: false,
});
function bridge(initial = view()) {
	let current = initial;
	const calls: AgentInput[] = [];
	vi.stubGlobal("quakeAgents", {
		request: async (command: AgentInput) => {
			calls.push(command);
			if (command.type === "save-model")
				current = {
					...current,
					revision: current.revision + 1,
					models: {
						default: (current.models.default ?? []).map((r) => ({
							...r,
							role: r.id === command.row.id ? "default" : "fallback",
						})),
					},
				};
			return { _tag: "success", view: current, draft: "" };
		},
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	});
	return calls;
}
function field(host: ParentNode, label: string) {
	const target = Array.from(host.querySelectorAll("label")).find(
		(l) => l.textContent === label,
	)?.htmlFor;
	return query(host, `[id="${target}"]`, HTMLInputElement);
}
it("AI-003/041/042/054/055/056/060 mounts, edits and reopens portable settings", async () => {
	bridge();
	let saved = Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")),
		childrenName: "aiChat",
		config: {
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
			type: "aiChat",
		},
	});
	function Consumer() {
		const [key, setKey] = useState(saved);
		return (
			<>
				<AssistantEditor keyValue={key} onChange={setKey} />
				<button
					type="button"
					onClick={() => {
						saved = key;
					}}
				>
					Save test key
				</button>
			</>
		);
	}
	const f = await mount(<Consumer />);
	closes.push(f.close);
	await settle(() => expect(f.host.textContent).toContain("openai"));
	expect(f.host.querySelector('a[href="?activeTab=settings"]')).not.toBeNull();
	const engine = query(f.host, 'select[id$="-engine"]', HTMLSelectElement);
	expect(
		Array.from(engine.options)
			.slice(1)
			.map((o) => o.text),
	).toEqual(["Qwen", "Kimi", "DeepSeek", "OpenAI"]);
	await input(engine, "qwen");
	await click(field(f.host, "Custom role"));
	await input(
		query(f.host, "textarea", HTMLTextAreaElement),
		"A custom retained prompt",
	);
	await input(field(f.host, "Personality"), "0.95");
	await input(field(f.host, "Reply quality"), "1.5");
	await input(field(f.host, "Chat timeout in seconds"), "30");
	await click(field(f.host, "Open chat window"));
	expect(field(f.host, "Use agent").checked).toBe(false);
	await click(button(f.host, "Save test key"));
	expect(saved.config.assistantSettings).toMatchObject({
		modelRowId: "qwen",
		roleId: -1,
		customPrompt: "A custom retained prompt",
		topP: 0.95,
		temperature: 1.5,
		contextTimeoutSeconds: 30,
		enableWakeTalkWindow: true,
		useAgent: false,
	});
	expect(JSON.stringify(Schema.encodeSync(ProfileKey)(saved))).not.toContain(
		"credential",
	);
	await f.render(<AssistantEditor keyValue={saved} onChange={() => {}} />);
	expect(query(f.host, "textarea", HTMLTextAreaElement).value).toBe(
		"A custom retained prompt",
	);
	expect(field(f.host, "Chat timeout in seconds").value).toBe("30");
});
it("AI-019/062 SETTINGS-008 shows loading, empty/single states and saves ordered explicit choice", async () => {
	const calls = bridge();
	const f = await mount(<AssistantProviderSettings />);
	closes.push(f.close);
	const select = query(f.host, "select", HTMLSelectElement);
	expect(
		Array.from(select.options)
			.slice(1)
			.map((o) => o.text),
	).toEqual(["Qwen", "Kimi", "DeepSeek", "OpenAI"]);
	await input(select, "deepseek");
	expect(calls.at(-1)).toMatchObject({
		type: "save-model",
		scope: "default",
		row: { id: "deepseek", role: "default" },
		secret: "",
	});
	expect(select.value).toBe("deepseek");
	await f.close();
	closes.pop();
	const first = rows[0];
	if (!first) throw new Error("provider fixture missing");
	bridge(view([first]));
	const single = await mount(<AssistantProviderSettings />);
	closes.push(single.close);
	expect(query(single.host, "select", HTMLSelectElement).disabled).toBe(true);
	await single.close();
	closes.pop();
	bridge(view([]));
	const empty = await mount(<AssistantProviderSettings />);
	closes.push(empty.close);
	expect(empty.host.querySelector("select")).toBeNull();
	expect(empty.host.textContent).toContain("—");
});
it("AI-054 MGMT-285 filters excluded roles and bounds custom prompts", async () => {
	function Consumer() {
		const [s, set] = useState(defaultAssistantSettings());
		return <AssistantControls rows={rows} value={s} onChange={set} />;
	}
	const f = await mount(<Consumer />);
	closes.push(f.close);
	const select = query(f.host, 'select[id$="-role"]', HTMLSelectElement);
	for (const id of [65, 122, 124, 125])
		expect(Array.from(select.options).some((o) => o.value === String(id))).toBe(
			false,
		);
	await input(field(f.host, "Filter roles"), "zzzzzzzz");
	expect(select.options.length).toBe(1);
	await click(field(f.host, "Custom role"));
	expect(query(f.host, "textarea", HTMLTextAreaElement).maxLength).toBe(3000);
});
it("KNOB-034 MGMT-308 retains malformed JSON and requires reviewed replacement", async () => {
	bridge();
	let changed = 0;
	const slot = {
		childrenName: "assistant",
		config: {
			type: "assistant",
			actions: [
				{ type: "voiceRoute", value: "legacyAssistant" },
				{ type: "assistant", value: "{malformed" },
			],
		},
	};
	const f = await mount(
		<KnobAssistantSettings
			slot={slot}
			original={slot.config.actions}
			onChange={() => {
				changed++;
			}}
		/>,
	);
	closes.push(f.close);
	expect(
		query(
			f.host,
			'textarea[aria-label="Preserved assistant JSON"]',
			HTMLTextAreaElement,
		).value,
	).toBe("{malformed");
	await click(button(f.host, "Preview migration"));
	await click(button(f.host, "Cancel migration"));
	expect(changed).toBe(0);
	await click(button(f.host, "Preview migration"));
	await click(button(f.host, "Use reviewed replacement"));
	expect(changed).toBe(1);
});
it("AI-065 MGMT-212 retains unknown agent model and previews recording states", async () => {
	bridge();
	const slot = {
		childrenName: "assistant",
		config: {
			type: "assistant",
			actions: [
				{ type: "voiceRoute", value: "dkclaw" },
				{ type: "agentId", value: "main" },
				{ type: "dkclawModel", value: "private/unknown" },
			],
		},
	};
	const f = await mount(
		<KnobAssistantSettings slot={slot} original={[]} onChange={() => {}} />,
	);
	closes.push(f.close);
	expect(
		query(f.host, "#knob-local-agent-model", HTMLSelectElement).value,
	).toBe("private/unknown");
	await click(button(f.host, "recording"));
	expect(f.host.querySelector('[data-stage="recording"]')).not.toBeNull();
	await click(button(f.host, "processing"));
	expect(f.host.querySelector('[data-stage="processing"]')).not.toBeNull();
	expect(knobAssignment("assistant").config).toMatchObject({
		icon: "0-50",
		animations: ["0-47", "0-48", "0-49", "0-51"],
	});
});

it("KNOB-034 MGMT-308 confirms migration, saves through KnobEditor and reopens idempotently", async () => {
	bridge();
	let saved = Schema.decodeUnknownSync(Profile)({
		id: "p",
		name: "Custom",
		revision: 0,
		pages: [{ id: "one", keys: [] }],
		knob: {
			keyCode: "0,1",
			config: {
				type: "knob",
				title: {
					text: "Knob",
					pos: "bot",
					size: 8,
					color: "#FFFFFF",
					display: true,
					style: "",
					resourceId: 0,
				},
				icon: "",
				size: [1, 1],
				display: true,
				subActions: [
					{
						childrenName: "assistant",
						config: {
							type: "assistant",
							actions: [
								{ type: "voiceRoute", value: "legacyAssistant" },
								{ type: "assistant", value: "{malformed" },
							],
						},
					},
					{ childrenName: "", config: { type: "", actions: [] } },
					{ childrenName: "", config: { type: "", actions: [] } },
				],
			},
		},
	});
	let writes = 0;
	vi.stubGlobal("quakeKeyLibrary", {
		request: async (
			command: import("../../../shared/key-library").KeyRequest,
		) => {
			if (command.type !== "save-knob") throw new Error("Unexpected command");
			writes++;
			saved = Schema.decodeUnknownSync(Profile)({
				...Schema.encodeSync(Profile)(saved),
				revision: saved.revision + 1,
				knob: command.knob,
			});
			return {
				_tag: "success",
				envelope: {
					schemaVersion: 1,
					profiles: [Schema.encodeSync(Profile)(saved)],
					activeByDevice: {},
				},
			};
		},
	});
	const f = await mount(<KnobEditor profile={saved} accept={() => {}} />);
	closes.push(f.close);
	await click(button(f.host, "Preview migration"));
	await click(button(f.host, "Cancel migration"));
	expect(writes).toBe(0);
	await click(button(f.host, "Preview migration"));
	await click(button(f.host, "Use reviewed replacement"));
	await click(button(f.host, "Save knob"));
	expect(writes).toBe(1);
	const knob = Option.getOrThrow(saved.knob);
	expect(JSON.stringify(knob)).toContain('"value":"direct"');
	expect(JSON.stringify(knob)).not.toContain("malformed");
	await f.render(
		<KnobEditor key="reopened" profile={saved} accept={() => {}} />,
	);
	expect(f.host.textContent).not.toContain("Preview migration");
	expect(query(f.host, "#knob-provider", HTMLSelectElement).value).toBe(
		"openai",
	);
});

it("AI-042 SETTINGS-102 links preserve the authorized document and request management navigation", async () => {
	const receive = vi.fn();
	window.addEventListener("open-quake:navigate", receive);
	try {
		const f = await mount(
			<AssistantLink page="settings">Open settings</AssistantLink>,
		);
		closes.push(f.close);
		const before = window.location.href;
		await click(query(f.host, "a", HTMLAnchorElement));
		expect(window.location.href).toBe(before);
		expect(receive).toHaveBeenCalledWith(
			expect.objectContaining({ detail: "settings" }),
		);
	} finally {
		window.removeEventListener("open-quake:navigate", receive);
	}
});

it("AI-058 saves the local entity subset without exposing unavailable entities as choices", async () => {
	vi.stubGlobal("quakeIntegrations", {
		request: async () => ({
			type: "ha",
			snapshot: { state: "Connected", allowlist: ["light.allowed"] },
		}),
	});
	let saved = defaultAssistantSettings();
	function Consumer() {
		const [value, setValue] = useState(saved);
		return (
			<AssistantControls
				value={value}
				rows={rows}
				onChange={(next) => {
					saved = next;
					setValue(next);
				}}
			/>
		);
	}
	const f = await mount(<Consumer />);
	closes.push(f.close);
	await click(button(f.host, "Select entities"));
	await settle(() => expect(f.host.textContent).toContain("light.allowed"));
	const checkbox = Array.from(f.host.querySelectorAll("label"))
		.find((l) => l.textContent === "light.allowed")
		?.querySelector("input");
	if (!(checkbox instanceof HTMLInputElement))
		throw new Error("entity checkbox missing");
	await click(checkbox);
	expect(saved.entityIds).toEqual(["light.allowed"]);
	expect(f.host.textContent).not.toContain("light.denied");
});

it("AI-065 selects an agent and model and retains the saved assignment on reopen", async () => {
	bridge({
		...view(),
		agents: ["main", "helper"].map((id) =>
			Schema.decodeUnknownSync(Agent)({ id, name: id, emoji: "", files: {} }),
		),
	});
	let saved: KnobSlot = {
		childrenName: "assistant",
		config: {
			type: "assistant",
			actions: [
				{ type: "voiceRoute", value: "dkclaw" },
				{ type: "agentId", value: "main" },
				{ type: "dkclawModel", value: "private/unknown" },
			],
		},
	};
	function Consumer() {
		const [slot, setSlot] = useState(saved);
		return (
			<KnobAssistantSettings
				slot={slot}
				original={slot.config.actions}
				onChange={(next) => {
					saved = next;
					setSlot(saved);
				}}
			/>
		);
	}
	const f = await mount(<Consumer />);
	closes.push(f.close);
	await input(query(f.host, "#knob-local-agent", HTMLSelectElement), "helper");
	await input(
		query(f.host, "#knob-local-agent-model", HTMLSelectElement),
		"qwen3.6-plus",
	);
	expect(saved.config.actions).toEqual([
		{ type: "voiceRoute", value: "dkclaw" },
		{ type: "agentId", value: "helper" },
		{ type: "dkclawModel", value: "qwen3.6-plus" },
	]);
	await f.render(
		<KnobAssistantSettings
			slot={saved}
			original={saved.config.actions}
			onChange={() => {}}
		/>,
	);
	expect(query(f.host, "#knob-local-agent", HTMLSelectElement).value).toBe(
		"helper",
	);
	expect(
		query(f.host, "#knob-local-agent-model", HTMLSelectElement).value,
	).toBe("qwen3.6-plus");
});

it("AI-019 SETTINGS-008 shows pending and failed provider reads", async () => {
	let rejectRead: (reason: Error) => void = () => {
		throw new Error("missing read");
	};
	vi.stubGlobal("quakeAgents", {
		request: () =>
			new Promise((_, reject) => {
				rejectRead = reject;
			}),
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	});
	const f = await mount(<AssistantProviderSettings />);
	closes.push(f.close);
	expect(f.host.textContent).toContain("Loading saved providers");
	expect(f.host.querySelector("select")).toBeNull();
	rejectRead(new Error("fixture unavailable"));
	await settle(() =>
		expect(f.host.textContent).toContain("couldn't be loaded"),
	);
	expect(f.host.querySelector("select")).toBeNull();
});

it("inactive named rows stay visible but cannot be selected for assistant dispatch", async () => {
	const source = rows[0];
	if (!source) throw new Error("missing model fixture");
	const inactive = {
		...source,
		id: "inactive",
		name: "Retired copy",
		role: "none" as const,
	};
	const f = await mount(
		<AssistantControls
			value={{ ...defaultAssistantSettings(), modelRowId: "inactive" }}
			rows={[...rows, inactive]}
			onChange={() => {}}
		/>,
	);
	closes.push(f.close);
	const option = f.host.querySelector('option[value="inactive"]');
	expect(option).toBeInstanceOf(HTMLOptionElement);
	expect(option?.hasAttribute("disabled")).toBe(true);
	expect(option?.textContent).toContain("unavailable");
});

it("provider selection skips inactive rows and disables providers without an eligible row", async () => {
	const source = rows[0];
	if (!source) throw new Error("missing model fixture");
	let saved = defaultAssistantSettings();
	const catalog: readonly PublicModelRow[] = [
		{ ...source, id: "inactive-first", role: "none" },
		{ ...source, id: "active-copy", role: "default" },
		{ ...source, id: "inactive-qwen", provider: "qwen", role: "none" },
	];
	const f = await mount(
		<AssistantControls
			value={saved}
			rows={catalog}
			onChange={(next) => {
				saved = next;
			}}
		/>,
	);
	closes.push(f.close);
	const engine = query(f.host, 'select[id$="-engine"]', HTMLSelectElement);
	await input(engine, "openai");
	expect(saved.modelRowId).toBe("active-copy");
	expect(
		Array.from(engine.options).find((option) => option.value === "qwen")
			?.disabled,
	).toBe(true);
	await input(engine, "qwen");
	expect(saved.modelRowId).toBe("active-copy");
});

it("General Settings default resolves new row before writing direct knob actions", async () => {
	bridge();
	let saved: KnobSlot = {
		childrenName: "assistant",
		config: {
			type: "assistant",
			assistantSettings: {
				...defaultAssistantSettings(),
				useAgent: false,
				modelRowId: "qwen",
				modelId: "custom-knob",
			},
			actions: [
				{ type: "voiceRoute", value: "direct" },
				{ type: "directProvider", value: "qwen" },
				{ type: "directModel", value: "custom-knob" },
			],
		},
	};
	function Consumer() {
		const [slot, set] = useState(saved);
		return (
			<KnobAssistantSettings
				slot={slot}
				original={slot.config.actions}
				onChange={(next) => {
					saved = next;
					set(next);
				}}
			/>
		);
	}
	const f = await mount(<Consumer />);
	closes.push(f.close);
	await input(query(f.host, 'select[id$="-model"]', HTMLSelectElement), "");
	expect(saved.config.actions).toEqual([
		{ type: "voiceRoute", value: "direct" },
		{ type: "directProvider", value: "openai" },
		{ type: "directModel", value: "custom-openai" },
	]);
	expect(
		"assistantSettings" in saved.config &&
			saved.config.assistantSettings?.modelRowId,
	).toBe("");
});

it("new knob assistant saves the displayed defaults through canonical direct selectors", async () => {
	bridge();
	const profile = Schema.decodeUnknownSync(Profile)({
		id: "p",
		name: "Custom",
		revision: 0,
		pages: [{ id: "one", keys: [] }],
	});
	let saved: KnobSlot | undefined;
	vi.stubGlobal("quakeKeyLibrary", {
		request: async (
			command: import("../../../shared/key-library").KeyRequest,
		) => {
			if (command.type !== "save-knob") throw new Error("Unexpected command");
			saved = command.knob.config.subActions[0];
			return { _tag: "success" };
		},
	});
	const f = await mount(<KnobEditor profile={profile} accept={() => {}} />);
	closes.push(f.close);
	await input(query(f.host, "#knob-function", HTMLSelectElement), "assistant");
	await input(query(f.host, "#knob-provider", HTMLSelectElement), "openai");
	await input(query(f.host, "#knob-model", HTMLSelectElement), "custom-openai");
	await click(button(f.host, "Save knob"));
	expect(saved?.config).toMatchObject({
		assistantSettings: {
			...defaultAssistantSettings(),
			modelRowId: "openai",
			modelId: "custom-openai",
		},
	});
});

it("canonical knob provider and model changes clear incompatible assistant controls", async () => {
	bridge();
	const profile = Schema.decodeUnknownSync(Profile)({
		id: "p",
		name: "Custom",
		revision: 0,
		pages: [{ id: "one", keys: [] }],
	});
	let saved: KnobSlot | undefined;
	vi.stubGlobal("quakeKeyLibrary", {
		request: async (
			command: import("../../../shared/key-library").KeyRequest,
		) => {
			if (command.type !== "save-knob") throw new Error("Unexpected command");
			saved = command.knob.config.subActions[0];
			return { _tag: "success" };
		},
	});
	const f = await mount(<KnobEditor profile={profile} accept={() => {}} />);
	closes.push(f.close);
	await input(query(f.host, "#knob-function", HTMLSelectElement), "assistant");
	await input(query(f.host, "#knob-provider", HTMLSelectElement), "qwen");
	await input(query(f.host, "#knob-model", HTMLSelectElement), "qwen3.6-plus");
	await click(field(f.host, "Enable thinking"));
	await click(field(f.host, "Web search"));
	expect(field(f.host, "Enable thinking").checked).toBe(true);
	expect(field(f.host, "Web search").checked).toBe(true);
	await input(query(f.host, "#knob-provider", HTMLSelectElement), "deepseek");
	await input(
		query(f.host, "#knob-model", HTMLSelectElement),
		"custom-deepseek",
	);
	await click(button(f.host, "Save knob"));
	expect(saved?.config).toMatchObject({
		assistantSettings: {
			modelRowId: "deepseek",
			modelId: "custom-deepseek",
			thinking: false,
			webSearch: false,
		},
	});
	expect(field(f.host, "Enable thinking").checked).toBe(false);
	expect(field(f.host, "Web search").checked).toBe(false);
});

it("followed General provider changes reconcile checked controls and cross-provider model IDs before save and reopen", async () => {
	let publish: (value: AgentView) => void = () => {};
	const models = (provider: string): readonly PublicModelRow[] =>
		rows.map((r) => ({
			...r,
			role: r.provider === provider ? "default" : "fallback",
		}));
	vi.stubGlobal("quakeAgents", {
		request: async () => ({
			_tag: "success",
			view: view(models("qwen")),
			draft: "",
		}),
		onSnapshot: (listener: typeof publish) => {
			publish = listener;
			return () => {};
		},
	});
	const saved = {
		...defaultAssistantSettings(),
		thinking: true,
		webSearch: true,
		modelId: "qwen3.6-plus",
	};
	const base = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	let key = Schema.decodeUnknownSync(ProfileKey)({
		...base,
		childrenName: "aiChat",
		config: { ...base.config, type: "aiChat", assistantSettings: saved },
	});
	function KeyConsumer() {
		const [current, setCurrent] = useState(key);
		return (
			<>
				<AssistantEditor keyValue={current} onChange={setCurrent} />
				<button
					type="button"
					onClick={() => {
						key = current;
					}}
				>
					Save key
				</button>
			</>
		);
	}
	const f = await mount(<KeyConsumer />);
	closes.push(f.close);
	await settle(() =>
		expect(field(f.host, "Enable thinking").checked).toBe(true),
	);
	expect(field(f.host, "Web search").checked).toBe(true);
	await act(async () => publish(view(models("deepseek"))));
	await settle(() =>
		expect(
			query(f.host, 'select[id$="-engine"]', HTMLSelectElement).value,
		).toBe("deepseek"),
	);
	expect(field(f.host, "Enable thinking").checked).toBe(false);
	expect(field(f.host, "Web search").checked).toBe(false);
	expect(query(f.host, 'input[id$="-model-id"]', HTMLInputElement).value).toBe(
		"",
	);
	await click(button(f.host, "Save key"));
	expect(key.config.assistantSettings).toMatchObject({
		modelRowId: "",
		modelId: "",
		thinking: false,
		webSearch: false,
	});
	await f.render(<AssistantEditor keyValue={key} onChange={() => {}} />);
	expect(field(f.host, "Enable thinking").checked).toBe(false);
	expect(field(f.host, "Web search").checked).toBe(false);
});

it("AI-228/229/230 updates preset/custom persona and slider endpoints, then reloads the saved selection", async () => {
	let saved = { ...defaultAssistantSettings(), useAgent: false };
	const updates: (typeof saved)[] = [];
	vi.stubGlobal("quakeChat", {
		persona: {
			read: async () => saved,
			update: async (next: typeof saved) => {
				saved = next;
				updates.push(next);
				return next;
			},
		},
	});
	const f = await mount(<PersonaSettings rows={rows} />);
	closes.push(f.close);
	await settle(() =>
		expect(f.host.querySelector('input[type="range"]')).not.toBeNull(),
	);
	const personality = field(f.host, "Personality");
	const quality = field(f.host, "Reply quality");
	expect([
		personality.min,
		personality.max,
		personality.step,
		personality.value,
	]).toEqual(["0", "1", "0.05", "0.7"]);
	expect([quality.min, quality.max, quality.step, quality.value]).toEqual([
		"0",
		"2",
		"0.05",
		"1",
	]);
	for (const text of ["Fastidious", "Flexible", "Conservative", "Gibberish"])
		expect(f.host.textContent).toContain(text);
	await input(query(f.host, 'select[id$="-role"]', HTMLSelectElement), "128");
	await input(personality, "0");
	await input(quality, "2");
	await click(button(f.host, "Update"));
	expect(saved).toMatchObject({ roleId: 128, topP: 0, temperature: 2 });
	await click(field(f.host, "Custom role"));
	await input(
		query(f.host, "textarea", HTMLTextAreaElement),
		"Saved custom persona",
	);
	await input(personality, "0.05");
	await input(quality, "1.95");
	await click(button(f.host, "Update"));
	expect(saved).toMatchObject({
		roleId: -1,
		customPrompt: "Saved custom persona",
		topP: 0.05,
		temperature: 1.95,
	});
	await f.render(<PersonaSettings key="reload" rows={rows} />);
	await settle(() =>
		expect(query(f.host, "textarea", HTMLTextAreaElement).value).toBe(
			"Saved custom persona",
		),
	);
	expect(field(f.host, "Custom role").checked).toBe(true);
	expect(field(f.host, "Personality").value).toBe("0.05");
	await click(field(f.host, "Custom role"));
	await input(query(f.host, 'select[id$="-role"]', HTMLSelectElement), "6");
	await click(button(f.host, "Update"));
	expect(saved).toMatchObject({ roleId: 6, customPrompt: "", rolePrompt: "" });
	expect(updates).toHaveLength(3);
});

it("AI-089 reviews a preserved legacy grid key before enabling the replacement", async () => {
	bridge();
	const legacy = {
		aiModelType: "old-model",
		useCustomPrompt: true,
		systemPrompt: "Translate this",
		enableWakeTalkWindow: true,
	};
	let saved = Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")),
		childrenName: "aiChat",
		config: {
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
			type: "aiChat",
			aiConfigData: legacy,
		},
	});
	const f = await mount(
		<AssistantEditor
			keyValue={saved}
			onChange={(next) => {
				saved = next;
			}}
		/>,
	);
	closes.push(f.close);
	expect(saved.config.assistantSettings).toBeUndefined();
	await click(button(f.host, "Preview migration"));
	await click(button(f.host, "Cancel migration"));
	expect(saved.config.assistantSettings).toBeUndefined();
	await click(button(f.host, "Preview migration"));
	await click(button(f.host, "Use reviewed replacement"));
	expect(saved.config.aiConfigData).toEqual(legacy);
	expect(saved.config.assistantSettings).toMatchObject({
		modelId: "old-model",
		customPrompt: "Translate this",
		useAgent: false,
		enableWakeTalkWindow: true,
	});
});

it("MGMT-213 assigns a saved HA key through KnobEditor Save and reopen without changing configData", async () => {
	bridge();
	const configData = JSON.stringify({
		entity_id: "light.desk",
		service: "toggle",
		service_data: { brightness: 40 },
		custom_display_type: "default",
		custom_display_settings: { fontSize: 24 },
		custom_display_detail: [],
	});
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	let saved = Schema.decodeUnknownSync(Profile)({
		id: "ha-profile",
		name: "HA",
		revision: 1,
		pages: [
			{
				id: "one",
				keys: [
					{
						...empty,
						childrenName: "homeAssistant",
						config: {
							...empty.config,
							type: "homeAssistant",
							actions: [{ type: "configData", value: configData }],
						},
					},
				],
			},
		],
	});
	let writes = 0;
	vi.stubGlobal("quakeKeyLibrary", {
		request: async (
			command: import("../../../shared/key-library").KeyRequest,
		) => {
			if (command.type !== "save-knob") throw new Error("unexpected command");
			writes++;
			saved = Schema.decodeUnknownSync(Profile)({
				...Schema.encodeSync(Profile)(saved),
				revision: saved.revision + 1,
				knob: command.knob,
			});
			return {
				_tag: "success",
				envelope: {
					schemaVersion: 1,
					profiles: [Schema.encodeSync(Profile)(saved)],
					activeByDevice: {},
				},
			};
		},
	});
	const f = await mount(<KnobEditor profile={saved} accept={() => {}} />);
	closes.push(f.close);
	await input(
		query(f.host, "#knob-function", HTMLSelectElement),
		"homeAssistant",
	);
	expect(button(f.host, "Save knob").disabled).toBe(true);
	await input(query(f.host, "#knob-ha-key", HTMLSelectElement), "one/1,1");
	await click(button(f.host, "Save knob"));
	expect(writes).toBe(1);
	expect(
		Schema.decodeUnknownSync(KnobResource)(Option.getOrThrow(saved.knob)).config
			.subActions[0].config.actions,
	).toEqual([{ type: "configData", value: configData }]);
	await f.render(
		<KnobEditor key="reopened-ha" profile={saved} accept={() => {}} />,
	);
	expect(query(f.host, "#knob-ha-key", HTMLSelectElement).value).toBe(
		"one/1,1",
	);
});

it.each(["CN", "DE", "US"])(
	"MGMT-398 retains and selects OpenAI with saved region %s",
	async (region) => {
		vi.stubGlobal(
			"quakeSettings",
			fakeBridge({ wizard: async () => wizard({ region }) }),
		);
		const calls = bridge(
			view(
				rows.map((row) => ({
					...row,
					role: row.id === "qwen" ? "default" : "fallback",
				})),
			),
		);
		const f = await mount(<AssistantProviderSettings />);
		closes.push(f.close);
		const provider = query(f.host, "select", HTMLSelectElement);
		expect(
			[...provider.options].some((option) => option.text === "OpenAI"),
		).toBe(true);
		await input(provider, "openai");
		expect(calls.at(-1)).toMatchObject({
			type: "save-model",
			row: { provider: "openai", role: "default" },
		});
		expect(provider.value).toBe("openai");
	},
);

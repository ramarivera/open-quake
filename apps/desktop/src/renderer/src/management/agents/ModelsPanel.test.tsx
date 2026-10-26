// @vitest-environment happy-dom
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { initialAgentState } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import {
	AgentCommand,
	type AgentInput,
	type AgentView,
	type PublicModelRow,
} from "../../../../shared/agents";
import { button, click, input, mount, query } from "../../../test/dom";
import { agentsStrings } from "./copy";
import { ModelsPanel } from "./ModelsPanel";

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0).reverse()) await close();
	vi.unstubAllGlobals();
});
async function fixture(
	provider: string,
	overrides: Partial<PublicModelRow> = {},
) {
	const row: PublicModelRow = {
		id: "saved",
		role: "default",
		provider,
		model: "ep-selected",
		baseUrl: "https://selected.invalid/v1",
		maxTokens: 1024,
		credentialAvailable: true,
		settings: { entryMethod: "inference", botId: "old-override" },
		...overrides,
	};
	const view: AgentView = {
		...initialAgentState(),
		models: { default: [row] },
		runtime: {
			available: false,
			status: "stopped",
			code: "",
			operation: "none",
		},
		progress: { percent: 0, stage: "idle", deviceApplied: false },
		draftingAvailable: false,
	};
	const calls: AgentInput[] = [];
	const mounted = await mount(
		<ModelsPanel
			view={view}
			busy={false}
			request={async (command) => {
				calls.push(command);
				const saved =
					command.type === "save-model"
						? {
								...view,
								models: {
									default: [{ ...command.row, credentialAvailable: true }],
								},
							}
						: view;
				return { _tag: "success", view: saved, draft: "" };
			}}
		/>,
	);
	closes.push(mounted.close);
	return { ...mounted, calls };
}

it("restricts OpenAI search to its supported model and clears the selection when switching away", async () => {
	const f = await fixture("openai", {
		model: "gpt-5.1",
		settings: undefined,
		controls: { webSearch: true },
	});
	const searches = () =>
		Array.from(f.host.querySelectorAll("label")).filter(
			(label) =>
				label.textContent?.trim() === agentsStrings.clawAIConfig.providerSearch,
		);
	expect(searches()).toHaveLength(1);
	const field = query(
		f.host,
		`[aria-label="${agentsStrings.clawAIConfig.modelCol} default 1"]`,
		HTMLInputElement,
	);
	for (const model of ["gpt-4o", "custom-model"]) {
		await input(field, model);
		expect(searches()).toHaveLength(0);
		await click(button(f.host, agentsStrings.clawAIConfig.saveRow));
		const command = f.calls.at(-1);
		if (command?.type !== "save-model") throw new Error("Expected save-model");
		expect(command.row.controls?.webSearch).not.toBe(true);
	}
	await input(field, "gpt-5.1");
	expect(searches()).toHaveLength(1);
	const checkbox = query(searches()[0] ?? f.host, "input", HTMLInputElement);
	expect(checkbox.checked).toBe(false);
	await click(checkbox);
	await click(button(f.host, agentsStrings.clawAIConfig.saveRow));
	const saved = f.calls.at(-1);
	if (saved?.type !== "save-model") throw new Error("Expected save-model");
	expect(saved.row.controls?.webSearch).toBe(true);
});

it.each(["volc", "coze"])(
	"saves cleared and trimmed optional bot IDs for %s through the mounted editor",
	async (provider) => {
		const f = await fixture(provider);
		const field = query(
			f.host,
			`[aria-label="${agentsStrings.clawAIConfig.botId} default 1"]`,
			HTMLInputElement,
		);
		for (const value of ["", "   ", "  new-override  "]) {
			await input(field, value);
			await click(button(f.host, agentsStrings.clawAIConfig.saveRow));
			const command = f.calls.at(-1);
			expect(command?.type).toBe("save-model");
			const decoded = Schema.decodeUnknownSync(AgentCommand)(command);
			if (decoded.type !== "save-model") throw new Error("Expected save-model");
			expect(decoded.row.settings?.botId).toBe(value.trim() || undefined);
			if (!value.trim())
				expect(command).not.toHaveProperty("row.settings.botId");
			expect(decoded.row.settings?.entryMethod).toBe("inference");
		}
	},
);

it("AI-043 copies named model metadata without secret input and protects built-in rows", async () => {
	const f = await fixture("qwen", {
		name: "Personal assistant",
		builtIn: true,
	});
	const source = query(
		f.host,
		'[aria-label="Name default 1"]',
		HTMLInputElement,
	);
	expect(source.disabled).toBe(true);
	const secret = query(f.host, 'input[type="password"]', HTMLInputElement);
	await input(secret, "unsaved-secret");
	await click(button(f.host, "Copy"));
	const copy = query(f.host, '[aria-label="Name default 2"]', HTMLInputElement);
	expect(copy.value).toBe("Personal assistant copy");
	expect(copy.disabled).toBe(false);
	expect(
		query(
			f.host,
			'input[type="password"][aria-label$="default 2"]',
			HTMLInputElement,
		).value,
	).toBe("");
	await input(copy, "Independent name");
	expect(source.value).toBe("Personal assistant");
	expect(copy.maxLength).toBe(30);
});

it("AI-043 locks built-in names and deletion while allowing an isolated copy", async () => {
	const f = await fixture("openai", {
		builtIn: true,
		name: "Built-in",
		model: "gpt-4o",
	});
	expect(
		query(f.host, '[aria-label="Name default 1"]', HTMLInputElement).disabled,
	).toBe(true);
	expect(button(f.host, agentsStrings.clawAIConfig.delete).disabled).toBe(true);
	await click(button(f.host, "Copy"));
	expect(
		query(f.host, '[aria-label="Name default 2"]', HTMLInputElement).disabled,
	).toBe(false);
});

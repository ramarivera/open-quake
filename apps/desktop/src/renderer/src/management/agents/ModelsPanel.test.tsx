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
async function fixture(provider: string) {
	const row: PublicModelRow = {
		id: "saved",
		role: "default",
		provider,
		model: "ep-selected",
		baseUrl: "https://selected.invalid/v1",
		maxTokens: 1024,
		credentialAvailable: true,
		settings: { entryMethod: "inference", botId: "old-override" },
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
				return { _tag: "success", view, draft: "" };
			}}
		/>,
	);
	closes.push(mounted.close);
	return { ...mounted, calls };
}

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

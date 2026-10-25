import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const model = process.env.OPEN_QUAKE_E2E_MODEL;
const config = {
	gateway: {
		mode: "local",
		bind: "lan",
		auth: { mode: "token", token: process.env.OPEN_QUAKE_E2E_RUNTIME_TOKEN },
		controlUi: { enabled: false },
		http: {
			endpoints: {
				chatCompletions: { enabled: true },
				responses: { enabled: true },
			},
		},
	},
	agents: {
		defaults: {
			model: { primary: `e2e/${model}` },
			workspace: "/state/workspace",
			skipBootstrap: true,
		},
	},
	models: {
		mode: "replace",
		providers: {
			e2e: {
				baseUrl: process.env.OPEN_QUAKE_E2E_BASE_URL,
				apiKey: process.env.OPEN_QUAKE_E2E_API_KEY || "no-key-required",
				api: "openai-completions",
				authHeader: true,
				models: [
					{
						id: model,
						name: model,
						reasoning: false,
						input: ["text"],
						contextWindow: 128000,
						maxTokens: 256,
					},
				],
			},
		},
	},
	tools: { deny: ["*"] },
	plugins: { enabled: false },
	cron: { enabled: false },
	browser: { enabled: false },
};
// HTTP adapters can't observe internal tool execution. Fail before startup if
// fixture configuration stops denying every tool.
assert.deepEqual(config.tools?.deny, ["*"], "E2E requires all tools denied");
writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config), {
	mode: 0o600,
});
const child = spawn(
	"node",
	["/app/openclaw.mjs", "gateway", "--allow-unconfigured"],
	{ stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
	process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));

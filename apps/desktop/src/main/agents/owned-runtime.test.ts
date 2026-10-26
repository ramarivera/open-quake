import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vitest";
import { AgentRuntimePort } from "../../../../../packages/edge/src/agents/agents-ports";
import { AgentsRuntime } from "../../../../../packages/edge/src/agents/agents-runtime";
import type { ServiceSettings } from "../../../../../packages/edge/src/agents/service-settings-contracts";
import { createLocalChannelRuntime } from "./channel-runtime";
import { createLocalAgentState } from "./local-state";
import {
	createOwnedAgentRuntime,
	type OwnedRuntimeProcess,
} from "./owned-runtime";

async function fixture(autoStart = false) {
	const root = await mkdtemp(join(tmpdir(), "owned-agents-"));
	const storage = createLocalAgentState(root);
	const starts: ServiceSettings[] = [];
	let stopped = 0;
	let stopFailure = false;
	let ready = true;
	let probing: () => void = () => {};
	const healthStarted = new Promise<void>((resolve) => {
		probing = resolve;
	});
	let stopping: () => void = () => {};
	const processStopped = new Promise<void>((resolve) => {
		stopping = resolve;
	});
	let becameReady: () => void = () => {};
	const runtimeReady = new Promise<void>((resolve) => {
		becameReady = resolve;
	});
	let exit: () => void = () => {};
	if (autoStart)
		await storage.saveSettings({
			...(await storage.readSettings()),
			autoStart,
		});
	const backend = createOwnedAgentRuntime({
		root,
		storage,
		driver: {
			start: async (settings) => {
				starts.push(settings);
				const exited = new Promise<void>((resolve) => {
					exit = resolve;
				});
				const process: OwnedRuntimeProcess = {
					exited,
					stop: async () => {
						stopped++;
						if (stopFailure) throw new Error("fake tree cleanup failed");
						exit();
						stopping();
					},
				};
				return process;
			},
			health: async () => {
				probing();
				return ready;
			},
		},
	});
	if (!backend?.administration) throw new Error("missing owned runtime");
	const unsubscribe = backend.subscribe?.((state) => {
		if (state.status === "ready") becameReady();
	});
	const runtime = ManagedRuntime.make(
		AgentsRuntime.Default.pipe(
			Layer.provide(Layer.succeed(AgentRuntimePort, backend)),
		),
	);
	return {
		root,
		storage,
		backend,
		admin: backend.administration,
		runtime,
		starts,
		healthStarted,
		processStopped,
		runtimeReady,
		stopped: () => stopped,
		stopFailure: (fail: boolean) => {
			stopFailure = fail;
		},
		exit: () => exit(),
		offline: () => {
			ready = false;
		},
		close: async () => {
			await runtime.dispose();
			unsubscribe?.();
			await rm(root, { recursive: true, force: true });
		},
	};
}
it("CENTER-047/048 owns start, consented restart, selected private directory and bounded clear, retaining workspace data", async () => {
	const f = await fixture();
	try {
		await f.runtime.runPromise(AgentsRuntime.control("start"));
		expect((await f.runtime.runPromise(AgentsRuntime.read())).status).toBe(
			"ready",
		);
		const settings = {
			...(await Effect.runPromise(f.admin.settings())),
			port: 19001,
			logLevel: "debug",
			dataDirectory: join(f.root, "data", "work"),
		} satisfies ServiceSettings;
		expect(
			await Effect.runPromise(
				f.admin.save(settings, false).pipe(Effect.either),
			),
		).toMatchObject({ _tag: "Left" });
		expect(f.starts).toHaveLength(1);
		await Effect.runPromise(f.admin.save(settings, true));
		expect(f.starts[1]).toEqual(settings);
		expect(f.stopped()).toBe(1);
		expect(await Effect.runPromise(f.admin.settings())).toEqual(settings);
		expect(
			JSON.parse(
				await readFile(join(settings.dataDirectory, "openclaw.json"), "utf8"),
			).gateway,
		).toMatchObject({ port: 19001, bind: "loopback" });
		expect(
			await Effect.runPromise(f.admin.clear.pipe(Effect.either)),
		).toMatchObject({ _tag: "Left" });
		await f.runtime.runPromise(AgentsRuntime.control("stop"));
		await mkdir(join(settings.dataDirectory, "credentials"));
		await writeFile(
			join(settings.dataDirectory, "credentials", "fake.json"),
			"private-fake",
		);
		await writeFile(join(f.root, "workspace-sentinel"), "keep");
		await Effect.runPromise(f.admin.clear);
		expect(await readdir(settings.dataDirectory)).toEqual([]);
		expect(await readFile(join(f.root, "workspace-sentinel"), "utf8")).toBe(
			"keep",
		);
		expect(await Effect.runPromise(f.admin.settings())).toEqual(settings);
		await expect(
			f.storage.saveSettings({
				...settings,
				dataDirectory: join(f.root, "..", "escape"),
			}),
		).rejects.toMatchObject({ code: "AGENT.KEY.INVALID" });
		await symlink(settings.dataDirectory, join(f.root, "data", "link"));
		await expect(
			f.storage.saveSettings({
				...settings,
				dataDirectory: join(f.root, "data", "link"),
			}),
		).rejects.toMatchObject({ code: "AGENT.STORAGE.FAILED" });
		expect(await Effect.runPromise(f.admin.settings())).toEqual(settings);
	} finally {
		await f.close();
	}
});
it("CENTER-047/104/MAIN-144 persists opt-in autostart, reports unexpected exit, rejects arbitrary environment and keeps redacted bounded logs", async () => {
	const f = await fixture(true);
	try {
		await f.runtime.runPromise(AgentsRuntime.read());
		await f.runtimeReady;
		expect(f.starts).toHaveLength(1);
		f.exit();
		await Promise.resolve();
		expect((await f.runtime.runPromise(AgentsRuntime.read())).status).toBe(
			"error",
		);
		await Effect.runPromise(f.admin.environment({ logLevel: "warn" }));
		expect((await f.storage.readSettings()).logLevel).toBe("warn");
		expect(await Effect.runPromise(f.admin.logs())).toEqual([
			{ status: "ready", operation: "start", code: "" },
			{ status: "error", operation: "start", code: "AGENT.RUNTIME.FAILED" },
		]);
	} finally {
		await f.close();
	}
});
it("CENTER-047 failed readiness cancels and stops only the owned fake process", async () => {
	const f = await fixture();
	try {
		f.offline();
		const controller = new AbortController();
		const pending = Effect.runPromise(f.backend.start, {
			signal: controller.signal,
		});
		await f.healthStarted;
		controller.abort();
		await expect(pending).rejects.toThrow();
		await f.processStopped;
		expect(f.stopped()).toBe(1);
		expect(
			createOwnedAgentRuntime({ root: f.root, command: "openclaw" }),
		).toBeUndefined();
	} finally {
		await f.close();
	}
});
it("CENTER-074 runtime and channel writes share one config owner and retain custom port and unrelated configuration", async () => {
	const f = await fixture();
	try {
		await f.storage.saveSettings({
			...(await f.storage.readSettings()),
			port: 19003,
		});
		await f.storage.mutateConfig((config) => ({
			...config,
			agents: { defaults: { workspace: "private-workspace" } },
			plugins: {
				allow: ["discord"],
				entries: { custom: { enabled: true, config: { keep: true } } },
			},
		}));
		const channels = createLocalChannelRuntime({
			root: f.root,
			storage: f.storage,
			run: async () =>
				JSON.stringify({
					chat: { discord: { installed: true } },
					channelAccounts: {},
				}),
		});
		await Promise.all([
			f.runtime.runPromise(AgentsRuntime.control("start")),
			channels.configure(
				{
					id: "discord",
					enabled: true,
					publicFields: {},
					credentialRef: "opaque",
				},
				{ token: "fake-secret" },
			),
		]);
		await channels.status();
		const config = JSON.parse(
			await readFile(join(f.root, "openclaw.json"), "utf8"),
		);
		expect(config.gateway.port).toBe(19003);
		expect(config.channels.discord.token).toBe("fake-secret");
		expect(config.agents.defaults.workspace).toBe("private-workspace");
		expect(config.plugins).toEqual({
			allow: ["discord"],
			entries: { custom: { enabled: true, config: { keep: true } } },
		});
	} finally {
		await f.close();
	}
});

it.each(["malformed", "outside directory"])(
	"CENTER-047 keeps management available after %s persisted settings",
	async (kind) => {
		const f = await fixture();
		try {
			await mkdir(f.root, { recursive: true });
			await writeFile(
				join(f.root, "service-settings.json"),
				kind === "malformed"
					? "{token=private-settings"
					: JSON.stringify({
							port: 18789,
							logLevel: "info",
							autoStart: true,
							dataDirectory: join(f.root, "..", "outside"),
						}),
			);
			const failure = await Effect.runPromise(
				f.admin.settings().pipe(Effect.either),
			);
			expect(failure).toMatchObject({
				_tag: "Left",
				left: { _tag: "AgentStorageFailed", code: "AGENT.STORAGE.FAILED" },
			});
			expect(JSON.stringify(failure)).not.toContain("private-settings");
			expect(await f.runtime.runPromise(AgentsRuntime.read())).toMatchObject({
				status: "stopped",
				code: "AGENT.STORAGE.FAILED",
			});
			expect(f.starts).toHaveLength(0);
			await f.storage.saveSettings({
				port: 18789,
				logLevel: "info",
				autoStart: false,
				dataDirectory: f.root,
			});
			await f.runtime.runPromise(AgentsRuntime.control("start"));
			expect(f.starts).toHaveLength(1);
		} finally {
			await f.close();
		}
	},
);

it("CENTER-047 retains the owned runtime after failed cleanup so Stop can retry", async () => {
	const f = await fixture();
	try {
		await f.runtime.runPromise(AgentsRuntime.control("start"));
		f.stopFailure(true);
		expect(
			await Effect.runPromise(f.backend.stop.pipe(Effect.either)),
		).toMatchObject({ _tag: "Left", left: { code: "AGENT.RUNTIME.FAILED" } });
		f.stopFailure(false);
		await Effect.runPromise(f.backend.stop);
		expect(f.stopped()).toBe(2);
		expect(f.starts).toHaveLength(1);
	} finally {
		await f.close();
	}
});

import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { Effect, Schema } from "effect";
import type { RuntimeState } from "../../../../../packages/edge/src/agents/agents-contracts";
import {
	AgentInvalid,
	AgentRuntimeFailed,
	AgentStorageFailed,
} from "../../../../../packages/edge/src/agents/agents-errors";
import type { AgentRuntimeAdapter } from "../../../../../packages/edge/src/agents/agents-ports";
import type { ServiceSettings } from "../../../../../packages/edge/src/agents/service-settings-contracts";
import { channelCommandRunner } from "./channel-command";
import { createLocalAgentState, type LocalAgentState } from "./local-state";
export interface OwnedRuntimeProcess {
	readonly stop: () => Promise<void>;
	readonly exited: Promise<void>;
}
export interface OwnedRuntimeDriver {
	readonly start: (
		settings: typeof ServiceSettings.Type,
	) => Promise<OwnedRuntimeProcess>;
	readonly health: (signal: AbortSignal) => Promise<boolean>;
}
function processDriver(
	command: string,
	storage: LocalAgentState,
): OwnedRuntimeDriver {
	return {
		start: async (settings) => {
			const root = settings.dataDirectory;
			const child = spawn(
				command,
				[
					"gateway",
					"run",
					"--allow-unconfigured",
					"--bind",
					"loopback",
					"--port",
					String(settings.port),
				],
				{
					shell: false,
					windowsHide: true,
					stdio: "ignore",
					env: {
						...process.env,
						OPENCLAW_STATE_DIR: root,
						OPENCLAW_CONFIG_PATH: `${root}/openclaw.json`,
						OPENCLAW_LOG_LEVEL: settings.logLevel,
					},
				},
			);
			const exited = new Promise<void>((resolve) => {
				child.once("error", () => resolve());
				child.once("close", () => resolve());
			});
			return {
				exited,
				stop: async () => {
					if (child.exitCode !== null || child.signalCode !== null) return;
					child.kill("SIGTERM");
					const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
					try {
						await exited;
					} finally {
						clearTimeout(kill);
					}
				},
			};
		},
		health: async (signal) => {
			const value = await channelCommandRunner(
				command,
				await storage.stateDirectory(),
			)({
				args: ["health", "--json", "--timeout", "1000"],
				signal,
				timeoutMs: 1500,
			});
			const result = Schema.decodeUnknownSync(
				Schema.parseJson(Schema.Struct({ ok: Schema.Boolean })),
			)(value);
			return result.ok;
		},
	};
}
/** Only launches an explicitly selected executable with private state. Never adopts or stops another process. */
export function createOwnedAgentRuntime(options: {
	readonly root: string;
	readonly command?: string | undefined;
	readonly driver?: OwnedRuntimeDriver;
	readonly storage?: LocalAgentState;
}): AgentRuntimeAdapter | undefined {
	if (!options.driver && (!options.command || !isAbsolute(options.command)))
		return;
	const storage = options.storage ?? createLocalAgentState(options.root);
	const driver =
		options.driver ?? processDriver(options.command ?? "", storage);
	const listeners = new Set<(state: RuntimeState) => void>();
	let state: RuntimeState = {
		available: true,
		status: "stopped",
		code: "",
		operation: "none",
	};
	let process: OwnedRuntimeProcess | undefined;
	const publish = (next: RuntimeState) => {
		state = next;
		journal.push({
			status: next.status,
			operation: next.operation,
			code: next.code,
		});
		if (journal.length > 64) journal.shift();
		for (const listener of listeners) listener(next);
	};
	const journal: {
		status: RuntimeState["status"];
		operation: RuntimeState["operation"];
		code: string;
	}[] = [];
	const read = storage.readSettings;
	const config = async (settings: typeof ServiceSettings.Type) =>
		storage.mutateConfig((value) => ({
			...value,
			gateway: {
				...Schema.decodeUnknownSync(
					Schema.Record({ key: Schema.String, value: Schema.Unknown }),
				)(value.gateway),
				port: settings.port,
			},
		}));
	const stop = async () => {
		const owned = process;
		process = undefined;
		if (owned) await owned.stop();
		publish({
			available: true,
			status: "stopped",
			operation: "stop",
			code: "",
		});
	};
	const start = async (signal: AbortSignal) => {
		if (process) return;
		const settings = await read();
		await config(settings);
		const owned = await driver.start(settings);
		process = owned;
		let exited = false;
		void owned.exited.then(() => {
			exited = true;
			if (process === owned) {
				process = undefined;
				publish({
					available: true,
					status: "error",
					operation: "start",
					code: "AGENT.RUNTIME.FAILED",
				});
			}
		});
		try {
			while (!signal.aborted && !exited) {
				let healthy = false;
				try {
					healthy = await driver.health(signal);
				} catch {
					if (signal.aborted) break;
				}
				if (healthy && !exited && !signal.aborted) {
					publish({
						available: true,
						status: "ready",
						operation: "start",
						code: "",
					});
					return;
				}
				await new Promise<void>((resolve) => {
					const done = () => {
						clearTimeout(timer);
						signal.removeEventListener("abort", done);
						resolve();
					};
					const timer = setTimeout(done, 100);
					signal.addEventListener("abort", done, { once: true });
					if (signal.aborted) done();
				});
			}
			throw new AgentRuntimeFailed();
		} catch (cause) {
			if (process === owned) process = undefined;
			await owned.stop();
			throw cause;
		}
	};
	let control = Promise.resolve();
	const external = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
		Effect.tryPromise({
			try: (signal) => {
				const work = control.then(() => operation(signal));
				control = work.then(
					() => {},
					() => {},
				);
				return work;
			},
			catch: (cause) =>
				cause instanceof AgentInvalid || cause instanceof AgentStorageFailed
					? cause
					: new AgentRuntimeFailed(cause),
		});
	return {
		available: true,
		initial: state,
		start: external(start),
		stop: external(stop),
		restart: external(async (signal) => {
			await stop();
			await start(signal);
		}),
		dispose: external(stop),
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		administration: {
			settings: () => external(read),
			logs: () => Effect.sync(() => [...journal]),
			save: (settings, restart) =>
				external(async (signal) => {
					if (process && !restart) throw new AgentInvalid();
					await storage.saveSettings(settings);
					if (process) {
						await stop();
						await start(signal);
					}
				}).pipe(
					Effect.timeoutFail({
						duration: "10 seconds",
						onTimeout: () => new AgentRuntimeFailed(),
					}),
				),
			clear: external(async () => {
				if (process) throw new AgentInvalid();
				await storage.clear();
			}),
			environment: (settings) =>
				external(async () => {
					const current = await read();
					await storage.saveSettings({
						...current,
						logLevel: settings.logLevel,
					});
				}),
		},
	};
}

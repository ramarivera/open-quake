import {
	type ChildProcess,
	type SpawnOptions,
	spawn,
} from "node:child_process";
import { isAbsolute } from "node:path";
import { Effect, Ref, Schema } from "effect";
import type { RuntimeState } from "../../../../../packages/edge/src/agents/agents-contracts";
import {
	AgentInvalid,
	AgentRuntimeFailed,
	AgentStorageFailed,
} from "../../../../../packages/edge/src/agents/agents-errors";
import type { AgentRuntimeAdapter } from "../../../../../packages/edge/src/agents/agents-ports";
import type { ServiceSettings } from "../../../../../packages/edge/src/agents/service-settings-contracts";
import { channelCommandRunner } from "./channel-command";
import { agentCommandInvocation } from "./command-invocation";
import { createLocalAgentState, type LocalAgentState } from "./local-state";
import { startWindowsJob, type WindowsJobApi } from "./windows-job";
import {
	terminateWindowsTree,
	windowsProcessIdentity,
	windowsTreeExists,
} from "./windows-process";

function bounded<A>(work: Promise<A>): Promise<A> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new AgentRuntimeFailed()), 1100);
		work.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(cause: unknown) => {
				clearTimeout(timer);
				reject(cause);
			},
		);
	});
}
function identityFailed(): AgentRuntimeFailed {
	return new AgentRuntimeFailed(
		Object.assign(new Error("Owned process identity could not be verified"), {
			code: "EPERM",
		}),
	);
}
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
export function ownedRuntimeProcessDriver(
	command: string,
	storage: LocalAgentState,
	options: {
		readonly platform?: NodeJS.Platform;
		readonly windowsJobApi?: WindowsJobApi;
		readonly spawn?: (
			command: string,
			args: readonly string[],
			options: SpawnOptions,
		) => Pick<
			ChildProcess,
			"once" | "kill" | "pid" | "exitCode" | "signalCode"
		>;
		readonly runCommand?: (
			command: string,
			args: readonly string[],
		) => Promise<void>;
		readonly treeExists?: (pid: number) => Promise<boolean>;
		readonly processIdentity?: (pid: number) => Promise<string | undefined>;
	} = {},
): OwnedRuntimeDriver {
	const platform = options.platform ?? process.platform;
	const spawnProcess = options.spawn ?? spawn;
	const runCommand = options.runCommand;
	const terminateTree = (pid: number, identity: string) =>
		runCommand
			? runCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"])
			: terminateWindowsTree(pid, identity);
	const treeExists = options.treeExists ?? windowsTreeExists;
	const processIdentity = options.processIdentity ?? windowsProcessIdentity;
	return {
		start: async (settings) => {
			const root = settings.dataDirectory;
			const [executable, args, spawnOptions] = agentCommandInvocation(
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
				platform,
			);
			const processOptions: SpawnOptions = {
				...spawnOptions,
				stdio: "ignore",
				env: {
					...process.env,
					OPENCLAW_STATE_DIR: root,
					OPENCLAW_CONFIG_PATH: `${root}/openclaw.json`,
					OPENCLAW_LOG_LEVEL: settings.logLevel,
				},
			};
			if (platform === "win32" && (!options.spawn || options.windowsJobApi))
				return startWindowsJob(
					executable,
					args,
					processOptions,
					options.windowsJobApi,
				);
			const child = spawnProcess(executable, args, processOptions);
			const cleanup = { pid: child.pid, treeStopped: false };
			let spawnFailed = false;
			let processorExited = false;
			const exited = new Promise<void>((resolve) => {
				child.once("error", () => {
					spawnFailed = cleanup.pid === undefined;
					resolve();
				});
				child.once("close", () => {
					processorExited = true;
					resolve();
				});
			});
			let identity: string | undefined;
			if (platform === "win32" && cleanup.pid) {
				try {
					const observed = await bounded(processIdentity(cleanup.pid));
					// kill(0) uses the spawned ChildProcess's native handle, not a
					// PID lookup. Only accept the sample while that object is alive.
					if (
						!processorExited &&
						child.exitCode === null &&
						child.signalCode === null &&
						child.kill(0)
					)
						identity = observed;
				} catch {
					// Keep the cleanup target, but never grant kill authority on an
					// unverified identity. Stop returns the catalogued failure below.
				}
			}
			return {
				exited,
				stop: async () => {
					// A confirmed creation error with no PID cannot have a gateway tree.
					if (spawnFailed) return;
					if (
						(child.exitCode !== null || child.signalCode !== null) &&
						(platform !== "win32" || cleanup.treeStopped)
					)
						return;
					const waitForExit = (timeoutMs: number) =>
						new Promise<boolean>((resolve) => {
							const timer = setTimeout(() => resolve(false), timeoutMs);
							void exited.then(() => {
								clearTimeout(timer);
								resolve(true);
							});
						});
					if (platform === "win32") {
						const pid = cleanup.pid;
						if (!pid) throw new AgentRuntimeFailed();
						// cmd.exe can exit before its gateway. Await taskkill itself as
						// well as the owned child; never fall back to killing only cmd.exe.
						for (let attempt = 0; attempt < 2; attempt++) {
							let active = true;
							try {
								await bounded(
									(async () => {
										if (!identity) throw identityFailed();
										const observed = await processIdentity(pid);
										if (
											observed === undefined &&
											processorExited &&
											!(await treeExists(pid))
										)
											return;
										if (!active || observed !== identity)
											throw identityFailed();
										try {
											await terminateTree(pid, identity);
										} catch (cause) {
											if (!processorExited || (await treeExists(pid)))
												throw cause;
										}
									})(),
								);
								if (await waitForExit(500)) {
									cleanup.treeStopped = true;
									return;
								}
							} catch (cause) {
								if (attempt === 1)
									throw cause instanceof AgentRuntimeFailed
										? cause
										: new AgentRuntimeFailed(cause);
							} finally {
								active = false;
							}
						}
					} else {
						child.kill("SIGTERM");
						if (await waitForExit(2000)) return;
						child.kill("SIGKILL");
						if (await waitForExit(500)) return;
					}
					throw new AgentRuntimeFailed();
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
		options.driver ?? ownedRuntimeProcessDriver(options.command ?? "", storage);
	const listeners = new Set<(state: RuntimeState) => void>();
	let state: RuntimeState = {
		available: true,
		status: "stopped",
		code: "",
		operation: "none",
	};
	// The child is a readiness candidate only in starting/ready. Its cleanup
	// target survives exit, failed Stop and failed startup until stop confirms it.
	type Lifecycle =
		| { readonly phase: "stopped" }
		| {
				readonly phase: "starting" | "ready" | "cleanup";
				readonly target: OwnedRuntimeProcess;
		  };
	const lifecycle = Ref.unsafeMake<Lifecycle>({ phase: "stopped" });
	// Promise and Node callbacks are the boundary of this Effect adapter.
	const current = () => Effect.runSync(Ref.get(lifecycle));
	const transition = (next: Lifecycle) =>
		Effect.runSync(Ref.set(lifecycle, next));
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
	const cleanup = async () => {
		const owned = current();
		if (owned.phase === "stopped") return;
		transition({ phase: "cleanup", target: owned.target });
		await owned.target.stop();
		transition({ phase: "stopped" });
	};
	const stop = async () => {
		await cleanup();
		publish({
			available: true,
			status: "stopped",
			operation: "stop",
			code: "",
		});
	};
	const start = async (signal: AbortSignal) => {
		if (current().phase === "ready") return;
		await cleanup();
		if (signal.aborted) throw new AgentRuntimeFailed();
		const settings = await read();
		await config(settings);
		const owned = await driver.start(settings);
		transition({ phase: "starting", target: owned });
		let exited = false;
		void owned.exited.then(() => {
			exited = true;
			const active = current();
			if (
				active.phase !== "stopped" &&
				active.target === owned &&
				active.phase !== "cleanup"
			) {
				transition({ phase: "cleanup", target: owned });
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
					transition({ phase: "ready", target: owned });
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
			await cleanup();
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
				cause instanceof AgentInvalid ||
				cause instanceof AgentStorageFailed ||
				cause instanceof AgentRuntimeFailed
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
					if (current().phase !== "stopped" && !restart)
						throw new AgentInvalid();
					await storage.saveSettings(settings);
					if (current().phase !== "stopped") {
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
				if (current().phase !== "stopped") throw new AgentInvalid();
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

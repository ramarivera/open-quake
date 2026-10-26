import { ChildProcess, type SpawnOptions } from "node:child_process";
import { it } from "@effect/vitest";
import { Effect, Layer, TestClock } from "effect";
import { expect, vi } from "vitest";
import { AgentRuntimePort } from "../../../../../packages/edge/src/agents/agents-ports";
import { AgentsRuntime } from "../../../../../packages/edge/src/agents/agents-runtime";
import type { LocalAgentState } from "./local-state";
import {
	createOwnedAgentRuntime,
	ownedRuntimeProcessDriver,
} from "./owned-runtime";

function fixture(failFirstSpawn = false) {
	const settings = {
		port: 18789,
		logLevel: "info",
		autoStart: false,
		dataDirectory: "/fake-owned",
	} as const;
	const storage: LocalAgentState = {
		root: settings.dataDirectory,
		readSettings: async () => settings,
		stateDirectory: async () => settings.dataDirectory,
		mutateConfig: async (mutate) => {
			mutate({ gateway: {} });
		},
		saveSettings: async () => {},
		clear: vi.fn(async () => {}),
	};
	const children: ChildProcess[] = [];
	const close = () => {
		const child = children.at(-1);
		if (!child) throw new Error("fake child missing");
		Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
		child.emit("close", 0, null);
	};
	const spawn = vi.fn(
		(_command: string, _args: readonly string[], _options: SpawnOptions) => {
			const child = new ChildProcess();
			vi.spyOn(child, "kill").mockReturnValue(true);
			if (failFirstSpawn && children.length === 0)
				queueMicrotask(() =>
					child.emit(
						"error",
						Object.assign(new Error("fake spawn failure"), { code: "ENOENT" }),
					),
				);
			else
				Object.defineProperty(child, "pid", { value: 4321 + children.length });
			children.push(child);
			return child;
		},
	);
	const runCommand = vi.fn(async (_command: string, _args: readonly string[]) =>
		close(),
	);
	const treeExists = vi.fn(async (_pid: number) => true);
	const processIdentity = vi.fn(
		async (_pid: number): Promise<string | undefined> => "638970000000000000",
	);
	const driver = ownedRuntimeProcessDriver("C:\\fake\\openclaw.cmd", storage, {
		platform: "win32",
		spawn,
		runCommand,
		treeExists,
		processIdentity,
	});
	const health = vi.fn(async (_signal: AbortSignal) => true);
	const backend = createOwnedAgentRuntime({
		root: settings.dataDirectory,
		storage,
		driver: { ...driver, health },
	});
	if (!backend?.administration) throw new Error("fake runtime missing");
	return {
		backend,
		admin: backend.administration,
		processIdentity,
		treeExists,
		spawn,
		runCommand,
		health,
		close,
		storage,
	};
}

it.effect(
	"4381279137 Stop terminates the retained Windows tree after an early shim exit",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			f.close();
			yield* Effect.promise(() => Promise.resolve());
			yield* f.backend.stop;
			expect(f.runCommand).toHaveBeenCalledExactlyOnceWith("taskkill.exe", [
				"/PID",
				"4321",
				"/T",
				"/F",
			]);
			yield* f.backend.stop;
			expect(f.runCommand).toHaveBeenCalledTimes(1);
		}),
);

it.effect(
	"4381279385 Stop retries failed tree cleanup even if the shim exits later",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			f.runCommand
				.mockRejectedValueOnce(new Error("fake failure"))
				.mockRejectedValueOnce(new Error("fake failure"));
			expect(yield* f.backend.stop.pipe(Effect.either)).toMatchObject({
				_tag: "Left",
				left: { code: "AGENT.RUNTIME.FAILED" },
			});
			f.close();
			yield* Effect.promise(() => Promise.resolve());
			yield* f.backend.stop;
			expect(f.runCommand).toHaveBeenCalledTimes(3);
			expect(f.runCommand.mock.calls[2]?.[1]).toEqual([
				"/PID",
				"4321",
				"/T",
				"/F",
			]);
		}),
);

it.effect(
	"4381279552 timed out startup retains failed cleanup for an explicit Stop",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			let entered: () => void = () => {};
			const checking = new Promise<void>((resolve) => {
				entered = resolve;
			});
			f.health.mockImplementation(
				(signal) =>
					new Promise<boolean>((resolve) => {
						entered();
						signal.addEventListener("abort", () => resolve(false), {
							once: true,
						});
					}),
			);
			f.runCommand
				.mockRejectedValueOnce(new Error("fake failure"))
				.mockRejectedValueOnce(new Error("fake failure"));
			yield* Effect.gen(function* () {
				const service = yield* AgentsRuntime;
				const starting = yield* service
					.control("start")
					.pipe(Effect.either, Effect.fork);
				yield* Effect.promise(() => checking);
				yield* TestClock.adjust("10 seconds");
				expect(yield* starting.await).toMatchObject({
					_tag: "Success",
					value: { _tag: "Left", left: { code: "AGENT.RUNTIME.TIMEOUT" } },
				});
				yield* f.backend.stop;
				expect(f.runCommand).toHaveBeenCalledTimes(3);
				expect((yield* service.read()).status).toBe("stopped");
			}).pipe(
				Effect.provide(
					AgentsRuntime.Default.pipe(
						Layer.provide(Layer.succeed(AgentRuntimePort, f.backend)),
					),
				),
			);
		}),
);

it.effect(
	"4381290893 Start cleans the exited tree and checks a new process before reporting ready",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			f.runCommand
				.mockImplementationOnce(async () => {
					f.close();
					throw new Error("fake failure");
				})
				.mockRejectedValueOnce(new Error("fake failure"));
			expect(yield* f.backend.stop.pipe(Effect.either)).toMatchObject({
				_tag: "Left",
			});
			yield* f.backend.start;
			expect(f.runCommand).toHaveBeenCalledTimes(3);
			expect(f.spawn).toHaveBeenCalledTimes(2);
			expect(f.health).toHaveBeenCalledTimes(2);
			yield* f.backend.stop;
		}),
);

it.effect(
	"4381510116 failed Windows spawn with no PID releases ownership for recovery",
	() =>
		Effect.gen(function* () {
			const f = fixture(true);
			expect(yield* f.backend.start.pipe(Effect.either)).toMatchObject({
				_tag: "Left",
				left: { code: "AGENT.RUNTIME.FAILED" },
			});
			yield* f.backend.stop;
			expect(f.runCommand).not.toHaveBeenCalled();
			yield* f.admin.clear;
			expect(f.storage.clear).toHaveBeenCalledTimes(1);
			yield* f.backend.start;
			expect(f.spawn).toHaveBeenCalledTimes(2);
			yield* f.backend.stop;
			expect(f.runCommand).toHaveBeenCalledExactlyOnceWith("taskkill.exe", [
				"/PID",
				"4322",
				"/T",
				"/F",
			]);
		}),
);

it.effect(
	"4381535855 a confirmed absent Windows tree releases cleanup for a new Start",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			f.close();
			f.runCommand.mockRejectedValue(new Error("fake taskkill PID not found"));
			f.treeExists.mockResolvedValue(false);
			yield* f.backend.stop;
			expect(f.treeExists).toHaveBeenCalledExactlyOnceWith(4321);
			yield* f.backend.stop;
			expect(f.runCommand).toHaveBeenCalledTimes(1);
			yield* f.backend.start;
			expect(f.spawn).toHaveBeenCalledTimes(2);
			f.runCommand.mockImplementation(async () => f.close());
			yield* f.backend.stop;
		}),
);

for (const failure of ["descendant remains", "probe failed"]) {
	it.effect(`4381535855 cleanup remains retryable when ${failure}`, () =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			f.close();
			f.runCommand.mockRejectedValue(new Error("fake taskkill PID not found"));
			if (failure === "probe failed")
				f.treeExists.mockRejectedValue(new Error("fake probe denied"));
			expect(yield* f.backend.stop.pipe(Effect.either)).toMatchObject({
				_tag: "Left",
				left: { code: "AGENT.RUNTIME.FAILED" },
			});
			expect(f.treeExists).toHaveBeenCalledTimes(2);
			f.treeExists.mockResolvedValue(false);
			yield* f.backend.stop;
			expect(f.treeExists.mock.calls[2]).toEqual([4321]);
		}),
	);
}

it.effect(
	"4381625938 a reused Windows PID never receives a tree termination command",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			f.close();
			f.processIdentity.mockResolvedValue("638970000000000001");
			const result = yield* f.backend.stop.pipe(Effect.either);
			expect(result).toMatchObject({
				_tag: "Left",
				left: {
					code: "AGENT.RUNTIME.FAILED",
					diagnosticCause: { sourceCode: "EPERM" },
				},
			});
			expect(f.runCommand).not.toHaveBeenCalled();
			expect(JSON.stringify(result)).not.toContain("638970000000000001");
		}),
);

it.effect(
	"4381625938 the same verified Windows process can be terminated",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			yield* f.backend.start;
			yield* f.backend.stop;
			expect(f.processIdentity).toHaveBeenCalledTimes(2);
			expect(f.runCommand).toHaveBeenCalledExactlyOnceWith("taskkill.exe", [
				"/PID",
				"4321",
				"/T",
				"/F",
			]);
		}),
);

for (const identity of ["missing", "failed query"]) {
	it.effect(
		`4381625938 ${identity} identity fails without killing and scrubs diagnostics`,
		() =>
			Effect.gen(function* () {
				const f = fixture();
				yield* f.backend.start;
				if (identity === "missing")
					f.processIdentity.mockResolvedValue(undefined);
				else
					f.processIdentity.mockRejectedValue(
						new Error("token=private-process-query"),
					);
				const result = yield* f.backend.stop.pipe(Effect.either);
				expect(result).toMatchObject({
					_tag: "Left",
					left: { code: "AGENT.RUNTIME.FAILED" },
				});
				expect(f.runCommand).not.toHaveBeenCalled();
				expect(JSON.stringify(result)).not.toContain("private-process-query");
			}),
	);
}

it.effect(
	"4381720113 absent-tree cleanup recovers after initial identity sampling fails",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			f.processIdentity.mockRejectedValueOnce(
				new Error("fake initial query failure"),
			);
			yield* f.backend.start;
			f.close();
			f.processIdentity.mockResolvedValue(undefined);
			f.treeExists.mockResolvedValue(false);
			yield* f.backend.stop;
			expect(f.runCommand).not.toHaveBeenCalled();
			expect(f.treeExists).toHaveBeenCalledExactlyOnceWith(4321);
			f.processIdentity.mockResolvedValue("638970000000000001");
			yield* f.backend.start;
			expect(f.spawn).toHaveBeenCalledTimes(2);
			yield* f.backend.stop;
			expect(f.runCommand).toHaveBeenCalledTimes(1);
		}),
);

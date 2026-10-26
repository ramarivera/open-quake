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

function fixture() {
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
			Object.defineProperty(child, "pid", { value: 4321 + children.length });
			children.push(child);
			return child;
		},
	);
	const runCommand = vi.fn(async (_command: string, _args: readonly string[]) =>
		close(),
	);
	const driver = ownedRuntimeProcessDriver("C:\\fake\\openclaw.cmd", storage, {
		platform: "win32",
		spawn,
		runCommand,
	});
	const health = vi.fn(async (_signal: AbortSignal) => true);
	const backend = createOwnedAgentRuntime({
		root: settings.dataDirectory,
		storage,
		driver: { ...driver, health },
	});
	if (!backend?.administration) throw new Error("fake runtime missing");
	return { backend, spawn, runCommand, health, close, storage };
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

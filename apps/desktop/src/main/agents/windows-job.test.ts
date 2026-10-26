import { ChildProcess } from "node:child_process";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import type { LocalAgentState } from "./local-state";
import {
	createOwnedAgentRuntime,
	ownedRuntimeProcessDriver,
} from "./owned-runtime";
import type { WindowsJobApi } from "./windows-job";

afterEach(() => vi.useRealTimers());
function fixture() {
	let rootExited = false;
	let active = 1;
	const order: string[] = [];
	const job = { owned: "job" },
		process = { owned: "process" },
		thread = { owned: "thread" };
	const api = {
		createJob: vi.fn(() => {
			order.push("job");
			return job;
		}),
		createSuspended: vi.fn(() => {
			order.push("suspended");
			return { process, thread };
		}),
		assign: vi.fn((_job: unknown, _process: unknown) => {
			order.push("assigned");
		}),
		resume: vi.fn((_thread: unknown) => {
			order.push("resumed");
		}),
		exited: vi.fn((_process: unknown) => rootExited),
		active: vi.fn((_job: unknown) => active),
		terminateJob: vi.fn((_job: unknown) => {
			active = 0;
		}),
		terminateProcess: vi.fn((_process: unknown) => {
			rootExited = true;
		}),
		close: vi.fn((_handle: unknown) => {}),
	} satisfies WindowsJobApi;
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
		mutateConfig: async () => {},
		saveSettings: async () => {},
		clear: async () => {},
	};
	const child = new ChildProcess();
	Object.defineProperty(child, "pid", { value: 4321 });
	vi.spyOn(child, "kill").mockReturnValue(true);
	const runCommand = vi.fn(
		async (_command: string, _args: readonly string[]) => {},
	);
	const identity = vi.fn(
		async (_pid: number): Promise<string | undefined> =>
			rootExited ? undefined : "638970000000000000",
	);
	const driver = ownedRuntimeProcessDriver("C:\\fake\\openclaw.cmd", storage, {
		platform: "win32",
		spawn: () => child,
		runCommand,
		treeExists: async () => true,
		processIdentity: identity,
		windowsJobApi: api,
	});
	const backend = createOwnedAgentRuntime({
		root: settings.dataDirectory,
		storage,
		driver: { ...driver, health: async () => true },
	});
	if (!backend) throw new Error("missing fake runtime");
	return {
		api,
		backend,
		job,
		process,
		thread,
		order,
		runCommand,
		identity,
		rootExit: () => {
			rootExited = true;
			Object.defineProperty(child, "exitCode", { value: 0 });
			child.emit("close", 0, null);
		},
	};
}

it("4381720098 cleanup owns gateway descendants after the Windows root exits", async () => {
	vi.useFakeTimers();
	const f = fixture();
	await Effect.runPromise(f.backend.start);
	f.rootExit();
	await vi.advanceTimersByTimeAsync(25);
	await Effect.runPromise(f.backend.stop);
	expect(f.api.terminateJob).toHaveBeenCalledExactlyOnceWith(f.job);
	expect(f.runCommand).not.toHaveBeenCalled();
	expect(f.identity).not.toHaveBeenCalled();
	expect(f.api.close).toHaveBeenCalledWith(f.job);
});

it("4381720098 assigns the suspended root before it can create descendants", async () => {
	const f = fixture();
	await Effect.runPromise(f.backend.start);
	expect(f.order).toEqual(["job", "suspended", "assigned", "resumed"]);
	await Effect.runPromise(f.backend.stop);
});

it("4381720098 a failed job termination retains handles for retry", async () => {
	const f = fixture();
	await Effect.runPromise(f.backend.start);
	f.api.terminateJob.mockImplementationOnce(() => {
		throw new Error("fake job termination denied");
	});
	expect(
		await Effect.runPromise(f.backend.stop.pipe(Effect.either)),
	).toMatchObject({ _tag: "Left", left: { code: "AGENT.RUNTIME.FAILED" } });
	expect(f.api.close).not.toHaveBeenCalledWith(f.job);
	await Effect.runPromise(f.backend.stop);
	expect(f.api.terminateJob).toHaveBeenCalledTimes(2);
	expect(f.api.close).toHaveBeenCalledWith(f.job);
});

it("4381720098 failed suspended creation releases the empty job and allows another Start", async () => {
	const f = fixture();
	f.api.createSuspended.mockImplementationOnce(() => {
		throw new Error("fake creation denied");
	});
	expect(
		await Effect.runPromise(f.backend.start.pipe(Effect.either)),
	).toMatchObject({ _tag: "Left" });
	expect(f.api.close).toHaveBeenCalledExactlyOnceWith(f.job);
	await Effect.runPromise(f.backend.start);
	await Effect.runPromise(f.backend.stop);
});

it("4381720098 failed assignment retains the suspended process if cleanup also fails", async () => {
	const f = fixture();
	f.api.assign.mockImplementationOnce(() => {
		throw new Error("fake assignment denied");
	});
	f.api.terminateProcess.mockImplementationOnce(() => {
		throw new Error("fake termination denied");
	});
	expect(
		await Effect.runPromise(f.backend.start.pipe(Effect.either)),
	).toMatchObject({ _tag: "Left" });
	expect(f.api.resume).not.toHaveBeenCalled();
	expect(f.api.close).not.toHaveBeenCalled();
	await Effect.runPromise(f.backend.stop);
	expect(f.api.terminateProcess).toHaveBeenCalledTimes(2);
	expect(f.api.close).toHaveBeenCalledWith(f.process);
});

it("4381720098 failed resume cleans up the assigned job", async () => {
	const f = fixture();
	f.api.resume.mockImplementationOnce(() => {
		throw new Error("fake resume denied");
	});
	expect(
		await Effect.runPromise(f.backend.start.pipe(Effect.either)),
	).toMatchObject({ _tag: "Left" });
	expect(f.api.terminateJob).toHaveBeenCalledExactlyOnceWith(f.job);
	expect(f.api.close).toHaveBeenCalledWith(f.process);
});

it("4381720098 closing a remaining handle can retry without querying the closed job", async () => {
	const f = fixture();
	await Effect.runPromise(f.backend.start);
	f.api.close
		.mockImplementationOnce(() => {})
		.mockImplementationOnce(() => {
			throw new Error("fake close denied");
		});
	expect(
		await Effect.runPromise(f.backend.stop.pipe(Effect.either)),
	).toMatchObject({ _tag: "Left" });
	f.api.active.mockImplementation(() => {
		throw new Error("closed job queried");
	});
	await Effect.runPromise(f.backend.stop);
	expect(f.api.close.mock.calls.filter(([h]) => h === f.job)).toHaveLength(1);
});

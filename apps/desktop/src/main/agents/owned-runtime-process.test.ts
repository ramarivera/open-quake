import { ChildProcess, type SpawnOptions } from "node:child_process";
import { win32 } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createLocalAgentState } from "./local-state";
import { ownedRuntimeProcessDriver } from "./owned-runtime";

afterEach(() => vi.useRealTimers());

async function fixture(platform: NodeJS.Platform) {
	const child = new ChildProcess();
	Object.defineProperty(child, "pid", { value: 4321 });
	const close = () => {
		Object.defineProperty(child, "exitCode", { value: 0, configurable: true });
		child.emit("close", 0, null);
	};
	const kill = vi.spyOn(child, "kill").mockImplementation(() => {
		close();
		return true;
	});
	const spawn = vi.fn(
		(_command: string, _args: readonly string[], _options: SpawnOptions) =>
			child,
	);
	const runCommand = vi.fn(async (_command: string, _args: readonly string[]) =>
		close(),
	);
	const root =
		platform === "win32"
			? win32.resolve("C:\\private-agent")
			: "/private-agent";
	const command =
		platform === "win32" ? win32.join(root, "openclaw.cmd") : "/opt/openclaw";
	const driver = ownedRuntimeProcessDriver(
		command,
		createLocalAgentState(root),
		{ platform, spawn, runCommand },
	);
	const owned = await driver.start({
		port: 18789,
		logLevel: "info",
		autoStart: false,
		dataDirectory: root,
	});
	return { child, close, kill, spawn, runCommand, owned };
}

it("CENTER-047 Windows shim stop waits for tree termination even when cmd.exe closes first", async () => {
	const f = await fixture("win32");
	let finish: () => void = () => {};
	f.runCommand.mockImplementation(async () => {
		f.close();
		await new Promise<void>((resolve) => {
			finish = resolve;
		});
	});
	expect(f.spawn.mock.calls[0]?.[0]).toMatch(/cmd.exe$/i);
	let stopped = false;
	const stop = f.owned.stop().then(() => {
		stopped = true;
	});
	await Promise.resolve();
	expect(f.runCommand).toHaveBeenCalledWith("taskkill.exe", [
		"/PID",
		"4321",
		"/T",
		"/F",
	]);
	expect(stopped).toBe(false);
	finish();
	await stop;
	expect(f.kill).not.toHaveBeenCalled();
});

it("CENTER-047 retries a failed Windows tree terminator without killing cmd.exe alone", async () => {
	const f = await fixture("win32");
	f.runCommand.mockRejectedValueOnce(new Error("fake command timeout"));
	await f.owned.stop();
	expect(f.runCommand).toHaveBeenCalledTimes(2);
	expect(f.kill).not.toHaveBeenCalled();
});

it("CENTER-047 Windows stop fails within a bound if tree exit never arrives", async () => {
	const f = await fixture("win32");
	f.runCommand.mockImplementation(async () => {});
	vi.useFakeTimers();
	const stop = expect(f.owned.stop()).rejects.toMatchObject({
		code: "AGENT.RUNTIME.FAILED",
	});
	await vi.runAllTimersAsync();
	await stop;
	expect(f.runCommand).toHaveBeenCalledTimes(2);
	expect(f.kill).not.toHaveBeenCalled();
});

it("CENTER-047 POSIX stop retains SIGTERM and escalates an unresponsive child to SIGKILL", async () => {
	const f = await fixture("linux");
	f.kill.mockImplementation((signal) => {
		if (signal === "SIGKILL") f.close();
		return true;
	});
	vi.useFakeTimers();
	const stop = f.owned.stop();
	expect(f.kill).toHaveBeenCalledWith("SIGTERM");
	await vi.advanceTimersByTimeAsync(2000);
	await stop;
	expect(f.kill).toHaveBeenCalledWith("SIGKILL");
	expect(f.runCommand).not.toHaveBeenCalled();
	expect(f.spawn.mock.calls[0]?.[0]).toBe("/opt/openclaw");
});

it("CENTER-047 bounds an unresponsive Windows command runner and reports failure", async () => {
	const f = await fixture("win32");
	f.runCommand.mockImplementation(() => new Promise(() => {}));
	vi.useFakeTimers();
	const stop = expect(f.owned.stop()).rejects.toMatchObject({
		code: "AGENT.RUNTIME.FAILED",
	});
	await vi.runAllTimersAsync();
	await stop;
	expect(f.runCommand).toHaveBeenCalledTimes(2);
	expect(f.kill).not.toHaveBeenCalled();
});

it("CENTER-047 retries failed tree cleanup after the command processor has already closed", async () => {
	const f = await fixture("win32");
	f.runCommand.mockImplementation(async () => {
		f.close();
		throw new Error("fake incomplete cleanup");
	});
	await expect(f.owned.stop()).rejects.toMatchObject({
		code: "AGENT.RUNTIME.FAILED",
	});
	f.runCommand.mockImplementation(async () => {});
	await f.owned.stop();
	expect(f.runCommand).toHaveBeenCalledTimes(3);
	expect(f.kill).not.toHaveBeenCalled();
});

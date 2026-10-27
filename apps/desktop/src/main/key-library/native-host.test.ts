import { Dirent } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { runApplicationAction } from "../profiles/native-actions";
import { nativeApplicationPort } from "./native-host";

const host = vi.hoisted(() => ({ readdir: vi.fn(), readlink: vi.fn() }));
vi.mock("node:fs/promises", () => ({ ...host, writeFile: vi.fn() }));
vi.mock("node:os", () => ({ platform: () => "linux" }));
vi.mock("electron", () => ({
	app: {},
	desktopCapturer: {},
	screen: {},
	shell: {},
}));
afterEach(() => vi.clearAllMocks());
const directory = (name: string) =>
	Object.assign(new Dirent(), { name, isDirectory: () => true });

it("MAIN-069/070: Linux uses complete /proc executable identities for focus and close", async () => {
	host.readdir.mockResolvedValue([
		directory("10"),
		directory("11"),
		directory("12"),
		directory("self"),
	]);
	host.readlink.mockImplementation(async (path: string) => {
		if (path === "/proc/10/exe") return "/opt/example/application";
		if (path === "/proc/11/exe") return "/opt/unrelated/application";
		throw Object.assign(new Error("Process ended"), { code: "ENOENT" });
	});
	const focus = vi.fn(),
		launch = vi.fn(),
		terminate = vi.fn();
	const port = { ...nativeApplicationPort, focus, launch, terminate };
	await runApplicationAction(port, "linux", "/opt/example/application", "open");
	expect(focus).toHaveBeenCalledWith(10, "/opt/example/application", undefined);
	expect(launch).not.toHaveBeenCalled();
	await runApplicationAction(
		port,
		"linux",
		"/opt/example/application",
		"close",
		true,
	);
	expect(terminate).toHaveBeenCalledExactlyOnceWith(10, true, undefined);
	expect(host.readlink).not.toHaveBeenCalledWith("/proc/self/exe");
});
it("MAIN-070: denied /proc entries are skipped, unexpected listing failures propagate", async () => {
	host.readdir.mockResolvedValue([directory("10")]);
	host.readlink.mockRejectedValueOnce(
		Object.assign(new Error("Denied"), { code: "EACCES" }),
	);
	expect(await nativeApplicationPort.list()).toEqual([]);
	const failure = Object.assign(new Error("Storage failed"), { code: "EIO" });
	host.readlink.mockRejectedValueOnce(failure);
	await expect(nativeApplicationPort.list()).rejects.toBe(failure);
});
it("MAIN-070: an aborted Linux listing never reads processes", async () => {
	const signal = AbortSignal.abort();
	await expect(nativeApplicationPort.list(signal)).rejects.toThrow();
	expect(host.readdir).not.toHaveBeenCalled();
});

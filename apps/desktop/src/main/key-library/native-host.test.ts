import { Dirent } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { runApplicationAction } from "../profiles/native-actions";
import { nativeApplicationPort } from "./native-host";

const host = vi.hoisted(() => ({
	platform: vi.fn(() => "linux"),
	exec: vi.fn(),
	readdir: vi.fn(),
	readlink: vi.fn(),
	realpath: vi.fn(),
	stat: vi.fn(),
	windowsFocus: vi.fn(() => true),
	windowsEnumerate: vi.fn(),
	windowsUnregister: vi.fn(),
}));
vi.mock("koffi", async () => {
	const actual = await vi.importActual<typeof import("koffi")>("koffi");
	return {
		...actual,
		load: () => ({
			func: (declaration: string) => {
				if (declaration.includes("GetWindowThreadProcessId"))
					return (_window: unknown, pid: number[]) => {
						pid[0] = 123;
					};
				if (declaration.includes("SetForegroundWindow"))
					return host.windowsFocus;
				if (declaration.includes("EnumWindows"))
					return (visitor: (window: unknown) => boolean) => {
						host.windowsEnumerate();
						visitor("owned-window");
					};
				return () => true;
			},
		}),
		register: (visitor: (window: unknown) => boolean) => visitor,
		unregister: host.windowsUnregister,
	};
});
vi.mock("node:child_process", () => ({
	execFile: (
		file: string,
		args: readonly string[],
		_options: unknown,
		callback: (error: unknown, stdout: string, stderr: string) => void,
	) => {
		try {
			host.exec(file, args);
			callback(null, "", "");
		} catch (cause) {
			callback(cause, "", "");
		}
	},
}));
vi.mock("node:fs/promises", () => ({ ...host, writeFile: vi.fn() }));
vi.mock("node:os", () => ({ platform: host.platform }));
vi.mock("electron", () => ({
	app: {},
	desktopCapturer: {},
	screen: {},
	shell: {},
}));
afterEach(() => {
	vi.clearAllMocks();
	host.platform.mockReturnValue("linux");
	vi.unstubAllEnvs();
});
host.realpath.mockImplementation(async (path: string) => path);
host.stat.mockImplementation(async (path: string) => ({ dev: 1, ino: path }));
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

it("review: Linux imported symlinks match canonical /proc identities and recheck PID", async () => {
	host.readdir.mockResolvedValue([directory("10")]);
	host.realpath.mockImplementation(async (path: string) =>
		path === "/usr/bin/editor" ? "/opt/editor/bin/app" : path,
	);
	host.readlink.mockResolvedValue("/opt/editor/bin/app");
	const focus = vi.fn(),
		launch = vi.fn(),
		terminate = vi.fn();
	const port = { ...nativeApplicationPort, focus, launch, terminate };
	await runApplicationAction(port, "linux", "/usr/bin/editor", "open");
	expect(focus).toHaveBeenCalledOnce();
	expect(launch).not.toHaveBeenCalled();
	host.readlink
		.mockResolvedValueOnce("/opt/editor/bin/app")
		.mockResolvedValueOnce("/opt/other/bin/app");
	await runApplicationAction(port, "linux", "/usr/bin/editor", "close");
	expect(terminate).not.toHaveBeenCalled();
});

it.each([false, true])(
	"review: macOS filesystem identity respects case-sensitive=%s",
	async (sensitive) => {
		host.platform.mockReturnValue("darwin");
		const same = nativeApplicationPort.sameApplication;
		if (!same) throw new Error("Missing canonical identity boundary");
		const wanted = "/applications/editor.app",
			actual = "/Applications/Editor.app/Contents/MacOS/Editor";
		host.stat.mockImplementation(async (path: string) => ({
			dev: 1,
			ino: sensitive ? path : path.toLowerCase(),
		}));
		expect(await same(wanted, actual)).toBe(!sensitive);
		const port = {
			...nativeApplicationPort,
			resolve: async (path: string) => path,
			list: async () => [{ pid: 10, path: actual }],
			identity: async () =>
				sensitive ? actual : "/Applications/Other.app/Contents/MacOS/Other",
			focus: vi.fn(),
			launch: vi.fn(),
			terminate: vi.fn(),
		};
		await runApplicationAction(port, "darwin", wanted, "close");
		expect(port.terminate).not.toHaveBeenCalled();
	},
);
it("review: Linux Wayland focus is explicitly unavailable without touching native focus", async () => {
	vi.stubEnv("XDG_SESSION_TYPE", "wayland");
	vi.stubEnv("WAYLAND_DISPLAY", "wayland-0");
	await expect(
		nativeApplicationPort.focus(123, "/opt/app"),
	).rejects.toMatchObject({
		_tag: "KeyFunctionUnavailable",
		code: "QUAKE.ACTION.UNAVAILABLE",
		reason: "adapter-missing",
	});
});

it("review: Linux X11 focus uses structured PID argv and missing xdotool is unavailable", async () => {
	vi.stubEnv("XDG_SESSION_TYPE", "x11");
	vi.stubEnv("DISPLAY", ":1");
	vi.stubEnv("WAYLAND_DISPLAY", "");
	await nativeApplicationPort.focus(123, "/opt/app");
	expect(host.exec).toHaveBeenCalledExactlyOnceWith("xdotool", [
		"search",
		"--onlyvisible",
		"--pid",
		"123",
		"windowactivate",
		"--sync",
	]);
	host.exec.mockImplementationOnce(() => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	});
	await expect(
		nativeApplicationPort.focus(123, "/opt/app"),
	).rejects.toMatchObject({
		_tag: "KeyFunctionUnavailable",
		reason: "adapter-missing",
	});
});

it("review: Windows can focus twice with the real persistent Koffi type registry", async () => {
	host.platform.mockReturnValue("win32");
	await nativeApplicationPort.focus(123, "C:\\editor.exe");
	await nativeApplicationPort.focus(123, "C:\\editor.exe");
	expect(host.windowsEnumerate).toHaveBeenCalledTimes(2);
	expect(host.windowsFocus).toHaveBeenCalledTimes(2);
	expect(host.windowsUnregister).toHaveBeenCalledTimes(2);

	await expect(
		nativeApplicationPort.focus(123, "C:\\editor.exe", AbortSignal.abort()),
	).rejects.toThrow();
	expect(host.windowsEnumerate).toHaveBeenCalledTimes(2);
	expect(host.windowsUnregister).toHaveBeenCalledTimes(3);
});

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	launchProfileCommand,
	type NativeApplicationPort,
	profileApplicationDialog,
	runApplicationAction,
} from "./native-actions";

const native = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => native);

describe("profile native actions", () => {
	it("accepts a long-running command on spawn without waiting for its exit", async () => {
		const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
		native.spawn.mockReturnValue(child);
		const launched = launchProfileCommand("linux", "gnome-control-center");
		expect(native.spawn).toHaveBeenCalledWith(
			"/bin/sh",
			["-c", "gnome-control-center"],
			{ detached: true, stdio: "ignore", windowsHide: true },
		);
		child.emit("spawn");
		await expect(launched).resolves.toBeUndefined();
		expect(child.unref).toHaveBeenCalledOnce();
	});
	it("reports launch failure", async () => {
		const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
		native.spawn.mockReturnValue(child);
		const cause = new Error("spawn failed");
		const launched = launchProfileCommand("win32", "start settings");
		child.emit("error", cause);
		await expect(launched).rejects.toBe(cause);
		expect(child.unref).not.toHaveBeenCalled();
	});
	it("shows extensionless Linux apps and keeps platform filters elsewhere", () => {
		expect(profileApplicationDialog("linux")).not.toHaveProperty("filters");
		expect(profileApplicationDialog("darwin").filters?.[0]?.extensions).toEqual(
			["app"],
		);
		expect(profileApplicationDialog("win32").filters?.[0]?.extensions).toEqual([
			"exe",
		]);
	});
});

for (const [platform, path, other] of [
	["darwin", "/Apps/Editor.app", "/Apps/Editor.app/Contents/MacOS/Editor"],
	["win32", "C:\\Apps\\Editor.exe", "c:\\apps\\EDITOR.EXE"],
	["linux", "/opt/editor", "/opt/editor"],
] as const) {
	it(`MAIN-069/070: ${platform} focuses exact app and closes only revalidated PID`, async () => {
		const focus = vi.fn(async () => {}),
			launch = vi.fn(async () => {}),
			terminate = vi.fn(async () => {});
		const port: NativeApplicationPort = {
			list: async () => [
				{ pid: 31, path: other },
				{ pid: 32, path: other + " helper" },
				{ pid: 33, path: other },
			],
			identity: async (pid) => (pid === 31 ? other : "/unrelated"),
			focus,
			launch,
			terminate,
		};
		await runApplicationAction(port, platform, path, "open");
		expect(focus).toHaveBeenCalledWith(31, path, undefined);
		expect(launch).not.toHaveBeenCalled();
		await runApplicationAction(port, platform, path, "close", true);
		expect(terminate).toHaveBeenCalledExactlyOnceWith(31, true, undefined);
		await runApplicationAction(
			{ ...port, list: async () => [] },
			platform,
			path,
			"open",
		);
		expect(launch).toHaveBeenCalledExactlyOnceWith(path);
	});
}
it("MAIN-070: cancellation and denied termination do not affect another PID", async () => {
	const abort = new AbortController(),
		terminate = vi.fn(async () => {});
	const port: NativeApplicationPort = {
		list: async () => [{ pid: 5, path: "/exact" }],
		identity: async () => {
			abort.abort();
			return "/exact";
		},
		focus: async () => {},
		launch: async () => {},
		terminate,
	};
	await expect(
		runApplicationAction(port, "linux", "/exact", "close", true, abort.signal),
	).rejects.toBeDefined();
	expect(terminate).not.toHaveBeenCalled();
	const denied = new Error("denied");
	terminate.mockRejectedValue(denied);
	await expect(
		runApplicationAction(
			{ ...port, identity: async () => "/exact" },
			"linux",
			"/exact",
			"close",
		),
	).rejects.toBe(denied);
	expect(terminate).toHaveBeenCalledExactlyOnceWith(5, false, undefined);
});

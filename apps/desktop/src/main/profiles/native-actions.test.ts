import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
	launchProfileCommand,
	profileApplicationDialog,
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

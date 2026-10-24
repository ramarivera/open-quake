import { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { copyGifFile } from "./clipboard";

vi.mock("node:child_process", () => ({
	execFile: vi.fn((...args: unknown[]) => {
		const callback = args.at(-1);
		if (typeof callback === "function") callback(null, "", "");
	}),
}));
describe("native GIF file-reference clipboard adapter, mocked processes", () => {
	it("passes a GIF path as AppleScript argument data without shell interpolation", async () => {
		const path = "/synthetic/quoted file ' $(not-a-command).gif";
		await copyGifFile("darwin", path);
		expect(execFile).toHaveBeenLastCalledWith(
			"/usr/bin/osascript",
			[
				"-e",
				"on run argv\nset gifFile to POSIX file (item 1 of argv)\nset the clipboard to gifFile\nend run",
				path,
			],
			{ timeout: 5000, maxBuffer: 65536 },
			expect.any(Function),
		);
	});
	it("uses LiteralPath and environment data in PowerShell, and rejects unsupported platforms", async () => {
		const path = "C:\\synthetic\\name ' ; fake.gif";
		await copyGifFile("win32", path);
		const call = vi.mocked(execFile).mock.calls.at(-1);
		expect(call?.[0]).toBe("powershell.exe");
		expect(call?.[1]).toEqual([
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"Set-Clipboard -LiteralPath $env:OPEN_QUAKE_EMOJI_FILE",
		]);
		const options = call?.[2];
		expect(
			typeof options === "object" &&
				options !== null &&
				"env" in options &&
				options.env?.OPEN_QUAKE_EMOJI_FILE === path,
		).toBe(true);
		expect(
			typeof options === "object" &&
				options !== null &&
				"windowsHide" in options &&
				options.windowsHide === true,
		).toBe(true);
		await expect(copyGifFile("linux", path)).rejects.toBeInstanceOf(RangeError);
	});
});

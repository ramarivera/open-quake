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
		expect(execFile).toHaveBeenLastCalledWith(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Set-Clipboard -LiteralPath $env:OPEN_QUAKE_EMOJI_FILE",
			],
			expect.objectContaining({
				env: expect.objectContaining({ OPEN_QUAKE_EMOJI_FILE: path }),
				windowsHide: true,
			}),
			expect.any(Function),
		);
		await expect(copyGifFile("linux", path)).rejects.toBeInstanceOf(RangeError);
	});
});

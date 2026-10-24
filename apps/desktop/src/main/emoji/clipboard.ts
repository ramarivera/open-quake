import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
/** Fixed programs and scripts. File paths are data, never shell interpolation. */
export async function copyGifFile(
	platform: string,
	path: string,
): Promise<void> {
	if (platform === "darwin") {
		await run(
			"/usr/bin/osascript",
			[
				"-e",
				"on run argv\nset gifFile to POSIX file (item 1 of argv)\nset the clipboard to gifFile\nend run",
				path,
			],
			{ timeout: 5000, maxBuffer: 65536 },
		);
		return;
	}
	if (platform === "win32") {
		await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Set-Clipboard -LiteralPath $env:OPEN_QUAKE_EMOJI_FILE",
			],
			{
				env: { ...process.env, OPEN_QUAKE_EMOJI_FILE: path },
				timeout: 5000,
				maxBuffer: 65536,
				windowsHide: true,
			},
		);
		return;
	}
	throw new RangeError(
		"Clipboard file copying is unsupported on this platform",
	);
}

import { execFile } from "node:child_process";
import { readlink, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, desktopCapturer, screen, shell } from "electron";
import type { NativeApplicationPort } from "../profiles/native-actions";

const run = promisify(execFile);
const macFocusScript =
	'on run argv\ntell application "System Events" to set frontmost of first process whose unix id is (item 1 of argv as integer) to true\nend run';
async function processList(
	signal?: AbortSignal,
): Promise<readonly { pid: number; path: string }[]> {
	if (platform() === "win32") {
		const { stdout } = await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress",
			],
			{ signal },
		);
		const raw: unknown = JSON.parse(stdout);
		const rows = Array.isArray(raw) ? raw : [raw];
		return rows.flatMap((row: unknown) =>
			typeof row === "object" &&
			row !== null &&
			"ProcessId" in row &&
			"ExecutablePath" in row &&
			typeof row.ProcessId === "number" &&
			typeof row.ExecutablePath === "string"
				? [{ pid: row.ProcessId, path: row.ExecutablePath }]
				: [],
		);
	}
	const { stdout } = await run("/bin/ps", ["-axo", "pid=,comm="], { signal });
	return stdout.split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(.+)$/.exec(line);
		return match?.[1] && match[2]
			? [{ pid: Number(match[1]), path: match[2] }]
			: [];
	});
}
export const nativeApplicationPort: NativeApplicationPort = {
	list: processList,
	resolve: async (reference, signal) => {
		if (!/^app:/i.test(reference)) return reference;
		if (platform() !== "darwin")
			throw new Error("Bundle references require macOS");
		const { stdout } = await run(
			"/usr/bin/osascript",
			[
				"-e",
				"on run argv\nreturn POSIX path of (path to application id (item 1 of argv))\nend run",
				reference.slice(4),
			],
			{ signal },
		);
		return stdout.trim().replace(/\/$/, "");
	},
	identity: async (pid, signal) => {
		if (platform() === "linux") {
			try {
				return await readlink(`/proc/${pid}/exe`);
			} catch {
				return undefined;
			}
		}
		return (await processList(signal)).find((p) => p.pid === pid)?.path;
	},
	focus: async (pid, _path, signal) => {
		if (platform() === "darwin") {
			await run("/usr/bin/osascript", ["-e", macFocusScript, String(pid)], {
				signal,
			});
			return;
		}
		if (platform() === "linux") {
			await run(
				"xdotool",
				[
					"search",
					"--onlyvisible",
					"--pid",
					String(pid),
					"windowactivate",
					"--sync",
				],
				{ signal },
			);
			return;
		}
		const k = await import("koffi");
		const user = k.load("user32.dll");
		const cb = k.proto(
			"bool __stdcall OQKeyEnumWindows(void *hwnd, intptr_t data)",
		);
		const getPid = user.func(
			"uint32_t __stdcall GetWindowThreadProcessId(void *hwnd, _Out_ uint32_t *pid)",
		);
		const visible = user.func("bool __stdcall IsWindowVisible(void *hwnd)");
		const show = user.func(
			"bool __stdcall ShowWindow(void *hwnd, int command)",
		);
		const focus = user.func("bool __stdcall SetForegroundWindow(void *hwnd)");
		let focused = false;
		const visitor = k.register((window: unknown) => {
			const processId = [0];
			getPid(window, processId);
			if (processId[0] !== pid || !visible(window)) return true;
			show(window, 9);
			focused = focus(window);
			return false;
		}, k.pointer(cb));
		try {
			signal?.throwIfAborted();
			user.func("bool __stdcall EnumWindows(void *callback, intptr_t data)")(
				visitor,
				0,
			);
		} finally {
			k.unregister(visitor);
		}
		if (!focused) throw new Error("Application focus denied");
	},
	launch: async (reference) => {
		if (/^app:/i.test(reference)) {
			if (platform() !== "darwin")
				throw new Error("Bundle references require macOS");
			await run("/usr/bin/open", ["-b", reference.slice(4)]);
			return;
		}
		const error = await shell.openPath(reference);
		if (error) throw new Error(error);
	},
	terminate: async (pid, force, signal) => {
		signal?.throwIfAborted();
		if (platform() === "win32") {
			await run(
				"taskkill.exe",
				[...(force ? ["/F"] : []), "/PID", String(pid)],
				{ signal },
			);
			return;
		}
		process.kill(pid, force ? "SIGKILL" : "SIGTERM");
	},
};
export interface ScreenshotPort {
	readonly displays: () => readonly {
		readonly workAreaSize: { readonly width: number; readonly height: number };
	}[];
	readonly capture: (size: {
		width: number;
		height: number;
	}) => Promise<readonly Uint8Array[]>;
	readonly pictures: () => string;
	readonly write: (path: string, bytes: Uint8Array) => Promise<void>;
	readonly now: () => number;
}
export async function captureScreenshots(port: ScreenshotPort): Promise<void> {
	const size = port.displays().reduce(
		(largest, display) => ({
			width: Math.max(largest.width, display.workAreaSize.width),
			height: Math.max(largest.height, display.workAreaSize.height),
		}),
		{ width: 1, height: 1 },
	);
	const images = await port.capture(size);
	const epoch = port.now();
	for (const [index, image] of images.entries())
		await port.write(
			join(port.pictures(), `screenshot-${epoch}-${index}.png`),
			image,
		);
}
export const screenshotPort: ScreenshotPort = {
	displays: () => screen.getAllDisplays(),
	capture: async (thumbnailSize) =>
		(
			await desktopCapturer.getSources({ types: ["screen"], thumbnailSize })
		).map((source) => source.thumbnail.toPNG()),
	pictures: () => app.getPath("pictures"),
	write: writeFile,
	now: Date.now,
};
export async function lockWorkstation(): Promise<void> {
	if (platform() !== "win32")
		throw new Error("LockWorkStation requires Windows");
	await run("rundll32.exe", ["user32.dll,LockWorkStation"]);
}

import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";
import { Clock, Effect, Option, Schema } from "effect";
import { ProfileForegroundFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import type { ProfilePlatform } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { ForegroundApp } from "../../../../../packages/device/src/profiles/profile-switching-invariants.js";

const run = promisify(execFile);
export const nativeForegroundApp = async (
	platform: ProfilePlatform,
): Promise<Option.Option<ForegroundApp>> => {
	const options = {
		timeout: 5000,
		signal: AbortSignal.timeout(5000),
		maxBuffer: 64 * 1024,
		windowsHide: true,
	};
	if (platform === "darwin") {
		const script = `ObjC.import('AppKit'); ObjC.import('CoreGraphics');
   const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
   const pid = Number(app.processIdentifier);
   const windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0)));
   const win = windows.find(w => w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0);
   JSON.stringify({id:String(win ? win.kCGWindowNumber : pid),path:ObjC.unwrap(app.bundleURL.path)});`;
		const { stdout } = await run(
			"/usr/bin/osascript",
			["-l", "JavaScript", "-e", script],
			options,
		);
		return Option.some(
			Schema.decodeUnknownSync(
				Schema.Struct({ id: Schema.String, path: Schema.String }),
			)(JSON.parse(stdout)),
		);
	}

	if (platform === "win32") {
		const script =
			'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class OQForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }\'; $w=[OQForeground]::GetForegroundWindow(); [uint32]$appPid=0; [void][OQForeground]::GetWindowThreadProcessId($w,[ref]$appPid); $p=Get-Process -Id $appPid -ErrorAction Stop; Write-Output $w.ToString(); Write-Output $p.Path';
		const { stdout } = await run(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			options,
		);
		const [id, path] = stdout.trim().split(/\r?\n/);
		return id && path ? Option.some({ id, path }) : Option.none();
	}
	const active = await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"], options);
	const id = /0x[\da-f]+/i.exec(active.stdout)?.[0];
	if (!id || id === "0x0") return Option.none();
	const owner = await run("xprop", ["-id", id, "_NET_WM_PID"], options);
	const pid = /=\s*(\d+)/.exec(owner.stdout)?.[1];
	return pid
		? Option.some({ id, path: await readlink(`/proc/${pid}/exe`) })
		: Option.none();
};
/** A single in-flight probe and clock-based 500 ms cache shared by all consumers. */
export const makeForegroundProbe = (
	platform: ProfilePlatform,
	native = nativeForegroundApp,
): (() => Effect.Effect<
	Option.Option<ForegroundApp>,
	ProfileForegroundFailed
>) => {
	let cached: Option.Option<ForegroundApp> = Option.none();
	let at = Number.NEGATIVE_INFINITY;
	let pending: Promise<Option.Option<ForegroundApp>> | undefined;
	return Effect.fn("ForegroundApp.probe")(function* (): Effect.fn.Return<
		Option.Option<ForegroundApp>,
		ProfileForegroundFailed
	> {
		const now = yield* Clock.currentTimeMillis;
		if (now - at <= 500) return cached;
		const result = yield* Effect.tryPromise({
			try: () => {
				if (!pending)
					pending = native(platform).finally(() => {
						pending = undefined;
					});
				return pending;
			},
			catch: ProfileForegroundFailed.fromCause,
		});
		cached = result;
		at = yield* Clock.currentTimeMillis;
		return result;
	});
};

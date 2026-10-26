import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Schema } from "effect";

const run = promisify(execFile);
const WindowsVolume = Schema.Struct({
	DeviceID: Schema.String.pipe(Schema.pattern(/^[A-Za-z]:$/)),
	VolumeName: Schema.Literal("QUAKE DFU"),
	DriveType: Schema.Literal(2),
});
export function windowsDfuPaths(raw: unknown): readonly string[] {
	const decoded = Schema.decodeUnknownSync(Schema.Array(WindowsVolume))(
		Array.isArray(raw) ? raw : [raw],
	);
	return decoded.map((v) => `${v.DeviceID}\\`);
}
/** Fixed command, no user input. Cache expensive label lookup for the recovered 5s interval. */
export function windowsDfuDiscovery(
	query: () => Promise<string> = async () => {
		const { stdout } = await run(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"@(Get-CimInstance Win32_LogicalDisk | Where-Object { $_.VolumeName -eq 'QUAKE DFU' -and $_.DriveType -eq 2 } | Select-Object DeviceID,VolumeName,DriveType) | ConvertTo-Json -Compress",
			],
			{ timeout: 5000, maxBuffer: 65536, windowsHide: true },
		);
		return stdout;
	},
	now: () => number = Date.now,
) {
	let cached: readonly string[] = [];
	let last: number | undefined;
	let pending: Promise<readonly string[]> | undefined;
	return (fresh = false): Promise<readonly string[]> => {
		if (pending) return pending;
		if (!fresh && last !== undefined && now() - last < 5000)
			return Promise.resolve(cached);
		last = now();
		pending = (async () => {
			try {
				const stdout = await query();
				cached = stdout.trim() ? windowsDfuPaths(JSON.parse(stdout)) : [];
				return cached;
			} catch (cause) {
				cached = [];
				throw cause;
			} finally {
				pending = undefined;
			}
		})();
		return pending;
	};
}

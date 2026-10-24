import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import type { ProfilePlatform } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
export interface InstalledProfileApp {
	readonly name: string;
	readonly path: string;
	readonly identifier: string;
}
const run = promisify(execFile);
export const canonicalProfileAppPath = (
	platform: ProfilePlatform,
	path: string,
): Promise<string> =>
	platform === "linux" ? realpath(path) : Promise.resolve(path);
const entries = async (directory: string): Promise<string[]> => {
	try {
		return await readdir(directory);
	} catch (cause) {
		if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
			return [];
		throw cause;
	}
};
/** Desktop files are data; never execute their command lines. */
export const desktopAppEntry = (
	text: string,
): { name: string; program: string } | undefined => {
	const section = text.split("[Desktop Entry]")[1]?.split(/\n\[/)[0];
	if (
		!section ||
		/^NoDisplay=true$/m.test(section) ||
		/^Hidden=true$/m.test(section)
	)
		return;
	const name = /^Name=(.+)$/m.exec(section)?.[1];
	const exec = /^Exec=(?:"([^"]+)"|([^\s]+))/m.exec(section);
	const program = exec?.[1] ?? exec?.[2];
	return name && program && program !== "env" ? { name, program } : undefined;
};
export const loadInstalledProfileApps = async (
	platform: ProfilePlatform,
	linuxDirectories: readonly string[] = [
		"/usr/share/applications",
		"/usr/local/share/applications",
	],
): Promise<readonly InstalledProfileApp[]> => {
	const apps: InstalledProfileApp[] = [];
	if (platform === "darwin") {
		for (const directory of ["/Applications", "/System/Applications"])
			for (const name of await entries(directory))
				if (name.endsWith(".app"))
					apps.push({
						name: name.slice(0, -4),
						identifier: name.slice(0, -4),
						path: join(directory, name),
					});
	} else if (platform === "win32") {
		const script =
			"$apps=@(Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths' -ErrorAction SilentlyContinue | ForEach-Object {$_.GetValue('')} | Where-Object {$_ -match '\\.exe$'}); ConvertTo-Json -Compress -InputObject $apps";
		const { stdout } = await run(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-Command", script],
			{ timeout: 5000, maxBuffer: 1048576, windowsHide: true },
		);
		for (const path of Schema.decodeUnknownSync(Schema.Array(Schema.String))(
			JSON.parse(stdout),
		))
			apps.push({
				name: basename(path, ".exe"),
				identifier: basename(path, ".exe"),
				path,
			});
	} else {
		for (const directory of linuxDirectories)
			for (const file of (await entries(directory)).filter((name) =>
				name.endsWith(".desktop"),
			)) {
				const entry = desktopAppEntry(
					await readFile(join(directory, file), "utf8"),
				);
				if (!entry) continue;
				let path = entry.program;
				if (!path.startsWith("/")) {
					try {
						path = (
							await run("which", [path], { timeout: 5000, maxBuffer: 4096 })
						).stdout.trim();
					} catch {
						continue;
					}
				}
				if (path) {
					try {
						path = await canonicalProfileAppPath(platform, path);
						apps.push({ name: entry.name, identifier: basename(path), path });
					} catch (cause) {
						if (
							!(
								cause instanceof Error &&
								"code" in cause &&
								cause.code === "ENOENT"
							)
						)
							throw cause;
					}
				}
			}
	}
	return [
		...new Map(
			apps
				.filter((a) => a.path && !a.path.endsWith(".lnk"))
				.map((a) => [a.identifier, a]),
		).values(),
	].sort((a, b) => a.name.localeCompare(b.name));
};

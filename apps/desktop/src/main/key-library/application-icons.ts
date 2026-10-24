import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Schema } from "effect";
import { app } from "electron";
import type { LibraryPack } from "../../shared/key-library";
import { loadInstalledProfileApps } from "../profiles/installed-apps";

const run = promisify(execFile);
const BundleIcon = Schema.Struct({ CFBundleIconFile: Schema.NonEmptyString });

/** Read declared resources without Electron's locked-session native icon lookup. */
async function macIcon(bundle: string, output: string): Promise<string> {
	const { stdout } = await run(
		"/usr/bin/plutil",
		["-convert", "json", "-o", "-", join(bundle, "Contents/Info.plist")],
		{ timeout: 3000, maxBuffer: 1048576 },
	);
	const metadata = Schema.decodeUnknownSync(BundleIcon)(JSON.parse(stdout));
	const name = metadata.CFBundleIconFile;
	if (name !== basename(name) || name === "." || name === "..")
		throw new Error("Invalid bundle icon resource.");
	const resource = join(
		bundle,
		"Contents/Resources",
		/\.[a-z0-9]+$/i.test(name) ? name : `${name}.icns`,
	);
	await run(
		"/usr/bin/sips",
		["-s", "format", "png", "-Z", "170", resource, "--out", output],
		{ timeout: 3000, maxBuffer: 65536 },
	);
	const bytes = await readFile(output);
	if (bytes.length > 8 * 1024 * 1024)
		throw new Error("Application icon is too large.");
	return `data:image/png;base64,${bytes.toString("base64")}`;
}

/** Extract on this host; no installed-app artwork is shipped with the application. */
export function applicationIconLibrary(): () => Promise<LibraryPack> {
	let cached: Promise<LibraryPack> | undefined;
	return () => {
		cached ??= (async () => {
			const platform =
				process.platform === "darwin"
					? "darwin"
					: process.platform === "win32"
						? "win32"
						: "linux";
			const installed = (await loadInstalledProfileApps(platform)).slice(
				0,
				512,
			);
			const directory =
				platform === "darwin"
					? await mkdtemp(join(tmpdir(), "quake-app-icons-"))
					: undefined;
			const icons: LibraryPack["icons"][number][] = [];
			try {
				for (let offset = 0; offset < installed.length; offset += 4) {
					const batch = await Promise.all(
						installed.slice(offset, offset + 4).map(async (entry, index) => {
							try {
								const data = directory
									? await macIcon(entry.path, join(directory, `${index}.png`))
									: (
											await app.getFileIcon(entry.path, { size: "large" })
										).toDataURL();
								if (data === "data:image/png;base64,") return undefined;
								return {
									id: createHash("sha256").update(entry.path).digest("hex"),
									name: entry.name,
									tags: [entry.identifier],
									data,
								};
							} catch {
								// Missing declarations, unsupported artwork and removed apps skip only that entry.
								return undefined;
							}
						}),
					);
					for (const icon of batch) if (icon) icons.push(icon);
				}
				return { id: "applications", name: "Installed applications", icons };
			} finally {
				if (directory) await rm(directory, { recursive: true, force: true });
			}
		})().catch((cause: unknown) => {
			cached = undefined;
			throw cause;
		});
		return cached;
	};
}

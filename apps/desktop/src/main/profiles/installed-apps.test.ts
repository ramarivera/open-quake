import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	canonicalProfileAppPath,
	desktopAppEntry,
	loadInstalledProfileApps,
} from "./installed-apps";

describe("installed Linux application data", () => {
	it("uses the same resolved executable for discovered and manually chosen symlink apps", async () => {
		const directory = await mkdtemp(join(tmpdir(), "profile-app-links-"));
		try {
			const executable = join(directory, "real-browser"),
				alias = join(directory, "browser");
			await writeFile(executable, "fixture");
			await symlink(executable, alias);
			await writeFile(
				join(directory, "browser.desktop"),
				`[Desktop Entry]\nName=Browser\nExec=${alias} --open %F`,
			);
			const apps = await loadInstalledProfileApps("linux", [directory]);
			const actual = await realpath(executable);
			expect(apps).toEqual([
				{ name: "Browser", identifier: "real-browser", path: actual },
			]);
			expect(await canonicalProfileAppPath("linux", alias)).toBe(actual);
			expect(await canonicalProfileAppPath("darwin", alias)).toBe(alias);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("reads executable identity without running desktop-file arguments", () => {
		expect(
			desktopAppEntry(
				'[Desktop Entry]\nName=Editor\nExec="/opt/My Editor/editor" --open %F\n[Other]\nName=Ignored',
			),
		).toEqual({ name: "Editor", program: "/opt/My Editor/editor" });
		expect(
			desktopAppEntry(
				"[Desktop Entry]\nName=Example\nExec=editor --command $(anything)",
			),
		).toEqual({ name: "Example", program: "editor" });
	});
	it("omits hidden entries, missing paths and env launchers", () => {
		for (const text of [
			"[Desktop Entry]\nName=Editor\nExec=editor\nHidden=true",
			"[Desktop Entry]\nName=Editor",
			"[Desktop Entry]\nName=Editor\nExec=env SECRET=ignored editor",
		])
			expect(desktopAppEntry(text)).toBeUndefined();
	});
});

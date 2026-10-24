import { describe, expect, it } from "vitest";
import { desktopAppEntry } from "./installed-apps";

describe("installed Linux application data", () => {
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

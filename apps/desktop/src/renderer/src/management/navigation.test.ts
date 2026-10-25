import { describe, expect, it } from "vitest";
import { parseAppearance } from "../theme/appearance";
import {
	managementActivation,
	navSections,
	pageLayouts,
	pageLocation,
	pages,
} from "./navigation";

describe("Management Center activation and migration", () => {
	it.each(["claw", "openclaw", "clawcontrolpanel"])(
		"opens sessions for %s",
		(alias) => {
			expect(managementActivation(alias)).toEqual({
				page: "agents",
				agentTab: "sessions",
			});
		},
	);
	it.each(["ai", "aiplugin", "shortcut", "shortcuts", "aishortcut"])(
		"opens shortcuts for %s",
		(alias) => {
			expect(managementActivation(alias)).toEqual({ page: "shortcuts" });
		},
	);
	it("opens AI configuration and ignores unknown market", () => {
		expect(managementActivation("openclaw-ai")).toEqual({
			page: "agents",
			agentTab: "ai",
		});
		expect(managementActivation("market")).toBeNull();
	});
	it("migrates version 1 without changing the selected palette or motion", () => {
		expect(
			parseAppearance(
				JSON.stringify({
					version: 1,
					theme: "dark",
					customTheme: null,
					motion: "reduce",
				}),
			),
		).toEqual({
			version: 2,
			theme: "dark",
			customTheme: null,
			motion: "reduce",
			fontScale: "small",
			sidebarWidth: null,
		});
	});
	it.each([119, 361, "218"])(
		"rejects invalid saved sidebar width %s",
		(sidebarWidth) => {
			expect(
				parseAppearance(
					JSON.stringify({
						version: 2,
						theme: "grey",
						fontScale: "small",
						sidebarWidth,
						customTheme: null,
						motion: "system",
					}),
				),
			).toBeNull();
		},
	);
});

describe("management information architecture", () => {
	const entries = navSections.flatMap((section) => section.items);
	it("lists every implemented page exactly once", () => {
		expect(entries.map((entry) => entry.id).sort()).toEqual([...pages].sort());
	});
	it("groups pages by task with Overview first", () => {
		expect(
			navSections.map((section) => [
				section.title,
				section.items.map((item) => item.label),
			]),
		).toEqual([
			[null, ["Overview"]],
			["Device", ["Keys", "Knob profiles", "Screen", "Controls", "Connection"]],
			["Assistant", ["Agents", "AI shortcuts", "AI emoji", "Meetings"]],
			["Integrations", ["Home Assistant"]],
			["App", ["Appearance", "Settings"]],
		]);
	});
	it("gives the agents workspace the full content width", () => {
		expect(pageLayouts.agents).toBe("full");
		expect(pageLayouts.settings).toBe("default");
		expect(pageLocation("keys")).toEqual({ section: "Device", label: "Keys" });
		expect(pageLocation("overview")).toEqual({
			section: null,
			label: "Overview",
		});
	});
	it.each(["meeting", "meetingminutes"])("opens meetings for %s", (alias) => {
		expect(managementActivation(alias)).toEqual({ page: "meetings" });
	});
});

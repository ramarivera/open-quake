import { describe, expect, it } from "vitest";
import {
	competingProcesses,
	isCompetingApp,
	isProbeCollection,
	TOUCH_PROBE_IDENTITY,
} from "./touch-probe-guards.mjs";

describe("lead-only probe guards, no native imports", () => {
	it("rejects competing app executable and Electron dev processes, excludes itself", () => {
		for (const command of [
			"/Applications/DK-Suite.app/Contents/MacOS/DK-Suite",
			"open-quake --inspect",
			"/a/Electron /Volumes/ExtSSD/devplane/oq-strip-touch/apps/desktop/out/main/index.js",
			"node /Users/me/dev/open-quake/node_modules/.bin/electron-vite dev",
		])
			expect(isCompetingApp(command)).toBe(true);
		expect(
			isCompetingApp("/Applications/T3 Code.app/Contents/MacOS/T3 Code"),
		).toBe(false);
		expect(
			isCompetingApp(
				"node packages/device/scripts/capture-touch.mjs --capture",
			),
		).toBe(false);
		expect(
			competingProcesses("1 open-quake\n2 open-quake\n3 node other.js", 1),
		).toEqual([2]);
	});
	it("can only select the exact vendor collection", () => {
		expect(isProbeCollection({ ...TOUCH_PROBE_IDENTITY, path: "fake" })).toBe(
			true,
		);
		expect(
			isProbeCollection({
				...TOUCH_PROBE_IDENTITY,
				path: "fake",
				usagePage: 0x0d,
				usage: 4,
			}),
		).toBe(false);
		expect(isProbeCollection({ ...TOUCH_PROBE_IDENTITY, path: "" })).toBe(
			false,
		);
	});
});

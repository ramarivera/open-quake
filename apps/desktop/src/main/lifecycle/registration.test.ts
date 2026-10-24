import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { canRequestLifecycle } from "./registration";

const electron = vi.hoisted(() => ({
	ipcMain: {
		handle:
			vi.fn<
				(
					name: string,
					handler: (
						event: IpcMainInvokeEvent,
						input: unknown,
					) => Promise<unknown>,
				) => void
			>(),
		removeHandler: vi.fn(),
	},
}));
vi.mock("electron", () => electron);
// Registration's identity checks are tested independently; no native display or HID edge exists here.
describe("diagnostic authorization", () => {
	it.each([
		["file:///app/renderer/index.html?surface=management", true, true, true],
		["https://foreign.invalid/renderer/index.html", true, true, false],
		["file:///app/renderer/index.html", false, true, false],
		["file:///app/renderer/index.html?surface=management", true, false, false],
	])(
		"checks exact document, main frame and main-owned management identity for %s",
		(url, main, management, expected) => {
			expect(
				canRequestLifecycle(
					String(url),
					"file:///app/renderer/index.html",
					Boolean(main),
					Boolean(management),
					{ action: "redetect" },
				),
			).toBe(expected);
		},
	);
});

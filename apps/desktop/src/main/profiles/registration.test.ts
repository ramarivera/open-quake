import { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	PROFILE_REQUEST,
	type ProfileReply,
} from "../../shared/profile-manager";
import { registerProfiles } from "./index";

const storage = vi.hoisted(() => ({
	read: vi.fn<() => Promise<unknown>>(),
	write: vi.fn<(envelope: unknown) => Promise<void>>(),
	recoveries: [],
}));
vi.mock("./local-profile-storage", () => ({
	createDesktopProfileStorage: () => storage,
}));
vi.mock("./profile-ipc", () => ({
	registerProfiles: () => ({ dispose: async () => {} }),
}));

const electron = vi.hoisted(() => {
	const frame = { url: "file:///application/index.html" };
	const sender = { mainFrame: frame, isDestroyed: () => false, send: vi.fn() };
	class Window {
		webContents = sender;
		isDestroyed = () => false;
		static getAllWindows = () => [];
		static fromWebContents = () => true;
	}
	return {
		frame,
		BrowserWindow: Window,
		app: { getPath: () => "/nonexistent/profile-registration-test" },
		dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
		ipcMain: {
			handle:
				vi.fn<
					(
						channel: string,
						handler: (
							event: {
								sender: { mainFrame: { url: string } };
								senderFrame: { url: string };
							},
							input: unknown,
						) => Promise<ProfileReply>,
					) => void
				>(),
			removeHandler: vi.fn(),
		},
	};
});
vi.mock("electron", () => electron);

afterEach(() => vi.unstubAllEnvs());

describe("profile IPC initialization recovery and document authority", () => {
	it.each(["read", "write"] as const)(
		"returns typed %s initialization failure and retries after storage recovers",
		async (operation) => {
			vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
			storage.read.mockResolvedValue(
				encodeProfileEnvelope(createInitialProfileEnvelope()),
			);
			storage.write.mockResolvedValue(undefined);
			storage[operation].mockRejectedValue(new Error("private token=secret"));
			const management = new BrowserWindow();
			electron.frame.url = "file:///application/index.html";
			const profiles = registerProfiles(() => management, electron.frame.url);
			try {
				const handler = electron.ipcMain.handle.mock.calls.find(
					([channel]) => channel === PROFILE_REQUEST,
				)?.[1];
				if (!handler) throw new Error("Missing request handler");
				const event = {
					sender: management.webContents,
					senderFrame: management.webContents.mainFrame,
				};
				const failed = await handler(event, { type: "read", locale: "en" });
				expect(failed).toEqual({
					_tag: "rejected",
					reason: `QUAKE.PROFILE.${operation.toUpperCase()}_FAILED`,
				});
				expect(JSON.stringify(failed)).not.toContain("secret");
				storage.read.mockResolvedValue(
					encodeProfileEnvelope(createInitialProfileEnvelope()),
				);
				storage.write.mockResolvedValue(undefined);
				expect(
					(await handler(event, { type: "read", locale: "en" }))._tag,
				).toBe("success");
				expect(profiles.currentLocale()).toBe("en");
				const changed = vi.fn();
				const unsubscribe = profiles.onLocaleChanged(changed);
				await handler(event, { type: "read", locale: "de" });
				expect(profiles.currentLocale()).toBe("de");
				expect(changed).toHaveBeenCalledOnce();
				await handler(event, { type: "read", locale: "ko", preview: true });
				expect(profiles.currentLocale()).toBe("de");
				expect(changed).toHaveBeenCalledOnce();
				unsubscribe();
				await handler(event, { type: "read", locale: "es" });
				expect(profiles.currentLocale()).toBe("es");
				expect(changed).toHaveBeenCalledOnce();
				const knobSelected = await profiles.select("1-2");
				expect(knobSelected.activeByDevice["desktop-preview"]?.profileId).toBe(
					"1-2",
				);
				const fromIPC = await handler(event, { type: "read", locale: "en" });
				expect(
					fromIPC._tag === "success" &&
						fromIPC.view.envelope.activeByDevice["desktop-preview"]?.profileId,
				).toBe("1-2");
				for (const suffix of ["?surface=foreign", "#foreign"]) {
					electron.frame.url = `file:///application/index.html${suffix}`;
					const writes = storage.write.mock.calls.length;
					expect(
						await handler(event, {
							type: "manage",
							command: { type: "create" },
						}),
					).toEqual({ _tag: "rejected", reason: "unauthorized" });
					expect(storage.write).toHaveBeenCalledTimes(writes);
				}
			} finally {
				await profiles.dispose();
			}
		},
	);
});

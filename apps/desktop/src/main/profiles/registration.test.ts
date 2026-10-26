import { Schema, TestClock } from "effect";
import { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	PROFILE_REQUEST,
	type ProfileReply,
} from "../../shared/profile-manager";
import { registerTestProfiles } from "../test/profile-registration";

const storage = vi.hoisted(() => ({
	read: vi.fn<() => Promise<unknown>>(),
	write: vi.fn<(envelope: unknown) => Promise<void>>(),
	recoveries: [],
}));
// Catalog parity has dedicated tests. Recovery needs only one installable template.
vi.mock(
	"../../../../../packages/device/src/profiles/profile-catalog.js",
	async (load) => {
		const catalog =
			await load<
				typeof import("../../../../../packages/device/src/profiles/profile-catalog.js")
			>();
		const { createInitialProfileEnvelope } = await import(
			"../../../../../packages/device/src/profiles/profile-contracts.js"
		);
		return {
			...catalog,
			builtinProfiles: () => [
				{ ...createInitialProfileEnvelope().profiles[0], id: "1-2" },
			],
		};
	},
);
vi.mock("./local-profile-storage", () => ({
	createDesktopProfileStorage: () => storage,
}));
vi.mock("./profile-ipc", () => ({
	registerProfiles: () => ({ dispose: async () => {} }),
}));

vi.mock("../monitor/monitor-store", () => ({
	monitorStorage: () => ({ load: async () => undefined }),
}));
vi.mock("./profile-thumbnails", async () => {
	const { Option } = await import("effect");
	return {
		createProfileThumbnailStore: () => ({
			read: async () => Option.none(),
			prune: async () => {},
			write: async () => {
				throw new Error("Unexpected thumbnail capture");
			},
		}),
	};
});

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

function fixture() {
	vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
	electron.frame.url = "file:///application/index.html";
	const management = new BrowserWindow();
	const profiles = registerTestProfiles(() => management, electron.frame.url);
	const handler = electron.ipcMain.handle.mock.calls.find(
		([channel]) => channel === PROFILE_REQUEST,
	)?.[1];
	if (!handler) throw new Error("Missing request handler");
	const event = {
		sender: management.webContents,
		senderFrame: management.webContents.mainFrame,
	};
	return { profiles, request: (input: unknown) => handler(event, input) };
}

describe("profile IPC initialization recovery and document authority", () => {
	it.each(["read", "write"] as const)(
		"returns typed %s initialization failure and retries after storage recovers",
		async (operation) => {
			let saved: unknown = encodeProfileEnvelope(
				createInitialProfileEnvelope(),
			);
			let available = false;
			let installed = () => {};
			const installation = new Promise<void>((resolve) => {
				installed = resolve;
			});
			const failure = new Error("private token=secret");
			storage.read.mockImplementation(async () => {
				if (operation === "read" && !available) throw failure;
				return saved;
			});
			storage.write.mockImplementation(async (value) => {
				if (operation === "write" && !available) throw failure;
				saved = value;
				installed();
			});
			const { profiles, request } = fixture();
			try {
				const failed = await request({ type: "read", locale: "en" });
				expect(failed).toEqual({
					_tag: "rejected",
					reason: `QUAKE.PROFILE.${operation.toUpperCase()}_FAILED`,
				});
				expect(JSON.stringify(failed)).not.toContain("secret");
				await profiles.runtime.runPromise(TestClock.adjust(0));
				expect(
					Array.from(await profiles.runtime.runPromise(TestClock.sleeps())),
				).toEqual([2000, 2000]);
				const attempts = storage[operation].mock.calls.length;
				// Recovery is an explicit state transition, independent of host time.
				available = true;
				await profiles.runtime.runPromise(TestClock.adjust(1999));
				expect(storage[operation]).toHaveBeenCalledTimes(attempts);
				await profiles.runtime.runPromise(TestClock.adjust(1));
				await installation;
				expect(storage.write).toHaveBeenCalledTimes(
					operation === "write" ? attempts + 1 : 1,
				);
				expect((await request({ type: "read", locale: "en" }))._tag).toBe(
					"success",
				);
			} finally {
				await profiles.dispose();
			}
		},
	);

	it("keeps locale, knob selection and document authority on the shared controller", async () => {
		const initial = encodeProfileEnvelope(createInitialProfileEnvelope());
		const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
			...initial,
			profiles: [
				...initial.profiles,
				{ ...initial.profiles[0], id: "1-2", name: "Other" },
			],
			manager: {
				revision: 1,
				installed: true,
				hidden: [],
				links: [],
				approvedCommands: [],
				userHasSetDefault: false,
			},
		});
		let saved: unknown = encodeProfileEnvelope(envelope);
		storage.read.mockImplementation(async () => saved);
		storage.write.mockImplementation(async (value) => {
			saved = value;
		});
		const { profiles, request } = fixture();
		try {
			expect((await request({ type: "read", locale: "en" }))._tag).toBe(
				"success",
			);
			expect(profiles.currentLocale()).toBe("en");
			const changed = vi.fn();
			const unsubscribe = profiles.onLocaleChanged(changed);
			await request({ type: "read", locale: "de" });
			expect(profiles.currentLocale()).toBe("de");
			expect(changed).toHaveBeenCalledOnce();
			await request({ type: "read", locale: "ko", preview: true });
			expect(profiles.currentLocale()).toBe("de");
			expect(changed).toHaveBeenCalledOnce();
			unsubscribe();
			await request({ type: "read", locale: "es" });
			expect(profiles.currentLocale()).toBe("es");
			expect(changed).toHaveBeenCalledOnce();
			const knobSelected = await profiles.select("1-2");
			expect(knobSelected.activeByDevice["desktop-preview"]?.profileId).toBe(
				"1-2",
			);
			const fromIPC = await request({ type: "read", locale: "en" });
			expect(
				fromIPC._tag === "success" &&
					fromIPC.view.envelope.activeByDevice["desktop-preview"]?.profileId,
			).toBe("1-2");
			for (const suffix of ["?surface=foreign", "#foreign"]) {
				electron.frame.url = `file:///application/index.html${suffix}`;
				const writes = storage.write.mock.calls.length;
				expect(
					await request({ type: "manage", command: { type: "create" } }),
				).toEqual({ _tag: "rejected", reason: "unauthorized" });
				expect(storage.write).toHaveBeenCalledTimes(writes);
			}
		} finally {
			await profiles.dispose();
		}
	});
});

it.each(["missing", "invalid"] as const)(
	"MGMT-042 connects a serial with %s active reference, publishes its initial profile and hands it to the editor",
	async (kind) => {
		vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
		electron.ipcMain.handle.mockClear();
		electron.frame.url = "file:///application/index.html";
		const initial = createInitialProfileEnvelope();
		storage.read.mockResolvedValue(
			encodeProfileEnvelope({
				...initial,
				activeByDevice:
					kind === "invalid"
						? { QUAKE: { profileId: "does-not-exist", pageId: "gone" } }
						: {},
			}),
		);
		storage.write.mockResolvedValue();
		const management = new BrowserWindow();
		const windows = vi
			.spyOn(BrowserWindow, "getAllWindows")
			.mockReturnValue([management]);
		const deliver = vi.fn(async (_serial: string, _profile: unknown) => {});
		const profiles = registerTestProfiles(
			() => management,
			electron.frame.url,
			deliver,
		);
		try {
			await profiles.connect("QUAKE");
			expect(deliver).toHaveBeenCalledOnce();
			expect(deliver.mock.calls[0]?.[0]).toBe("QUAKE");
			const handler = electron.ipcMain.handle.mock.calls.find(
				([channel]) => channel === PROFILE_REQUEST,
			)?.[1];
			if (!handler) throw new Error("Missing profile IPC");
			const result = await handler(
				{
					sender: management.webContents,
					senderFrame: management.webContents.mainFrame,
				},
				{ type: "read", locale: "en" },
			);
			expect(result._tag).toBe("success");
			if (result._tag === "success") {
				const selection = result.view.envelope.activeByDevice.QUAKE;
				expect(selection).toBeDefined();
				expect(
					result.view.envelope.profiles.some(
						(profile) => profile.id === selection?.profileId,
					),
				).toBe(true);
				expect(result.view.serials).toContain("QUAKE");
			}
			expect(management.webContents.send).toHaveBeenCalledWith(
				"profiles:selection",
				expect.objectContaining({ serial: "QUAKE", hardware: "unverified" }),
			);
		} finally {
			await profiles.dispose();
			windows.mockRestore();
		}
	},
);

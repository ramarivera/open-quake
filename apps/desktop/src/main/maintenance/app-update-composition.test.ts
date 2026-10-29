import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";
import { AppUpdates } from "../../../../../packages/edge/src/maintenance/update-service";
import { prepareMaintenance, registerMaintenance } from "./index";

const managementWindow = {
	isDestroyed: () => false,
	isMinimized: () => false,
	isVisible: () => true,
	focus: () => {},
	webContents: {
		getURL: () => "https://app.invalid",
		send: () => {},
		executeJavaScript: async () => null,
	},
} as unknown as BrowserWindow;

const native = vi.hoisted(() => ({
	app: { getVersion: () => "1.0.0" },
	dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	shell: { openExternal: vi.fn(async () => {}) },
}));
vi.mock("electron", () => native);
it("routes the real manual check/download/approval/install request path through the owned adapter", async () => {
	const root = await mkdtemp(join(tmpdir(), "owned-composition-"));
	const key = generateKeyPairSync("ed25519");
	const artifact = Buffer.from("synthetic nonexecutable artifact");
	const release = {
		app: "open-quake",
		version: "1.1.0",
		platform: process.platform,
		arch: process.arch,
		bytes: artifact.length,
		sha256: createHash("sha256").update(artifact).digest("hex"),
		artifact: "https://artifacts.invalid/file",
	};
	const payload = JSON.stringify(release);
	const envelope = JSON.stringify({
		payload,
		signature: sign(null, Buffer.from(payload), key.privateKey).toString(
			"base64",
		),
	});
	let finish = () => {};
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const transport = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(envelope))
		.mockImplementationOnce(async () => {
			await gate;
			return new Response(artifact);
		});
	const install = vi.fn(async () => {});
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://app.invalid",
		management: () => managementWindow,
		hardware: () => undefined,
		stopWriters: async () => {},
		updater: {
			feed: "https://feed.invalid/metadata",
			artifactOrigin: "https://artifacts.invalid",
			publicKey: key.publicKey
				.export({ type: "spki", format: "pem" })
				.toString(),
			fetch: transport,
			install,
		},
	});
	try {
		await owner.ready;
		expect(await owner.request({ action: "check-update" })).toMatchObject({
			ok: true,
			view: {
				appVersion: "1.0.0",
				update: { state: "available", version: "1.1.0", prompt: true },
			},
		});
		expect(await owner.request({ action: "download-update" })).toMatchObject({
			ok: true,
			view: { update: { state: "downloading", prompt: true } },
		});
		expect(await owner.request({ action: "download-update" })).toMatchObject({
			ok: true,
			view: { update: { state: "downloading" } },
		});
		expect(transport).toHaveBeenCalledTimes(2);
		finish();
		await vi.waitFor(async () =>
			expect(await owner.request({ action: "read" })).toMatchObject({
				ok: true,
				view: { update: { state: "ready" } },
			}),
		);
		await owner.request({ action: "defer-update" });
		expect(await owner.request({ action: "check-update" })).toMatchObject({
			ok: true,
			view: { update: { state: "ready", prompt: true } },
		});
		await owner.request({ action: "install-update" });
		expect(install).not.toHaveBeenCalled();
		native.dialog.showMessageBox.mockResolvedValueOnce({ response: 1 });
		expect(await owner.request({ action: "install-update" })).toMatchObject({
			ok: true,
			view: { update: { state: "idle", prompt: false } },
		});
		expect(install).toHaveBeenCalledOnce();
		await owner.request({ action: "install-update" });
		expect(install).toHaveBeenCalledOnce();
		transport.mockResolvedValueOnce(new Response(envelope));
		expect(await owner.request({ action: "check-update" })).toMatchObject({
			ok: true,
			view: { update: { state: "available" } },
		});
	} finally {
		finish();
		await owner.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("MAIN-114 manual packages expose the owned releases page and distribution notice through maintenance", async () => {
	const root = await mkdtemp(join(tmpdir(), "manual-update-"));
	const owner = registerMaintenance({
		root,
		mock: false,
		fixture: { roots: [], descriptors: [], bundledDirectories: [] },
		renderer: "https://app.invalid",
		management: () => managementWindow,
		hardware: () => undefined,
		stopWriters: async () => {},
	});
	try {
		await owner.ready;
		expect(await owner.request({ action: "check-update" })).toMatchObject({
			ok: true,
			view: { update: { state: "disabled" } },
			message: expect.stringContaining("Windows builds are unsigned"),
		});
		expect(native.shell.openExternal).toHaveBeenCalledWith(
			"https://github.com/ramarivera/open-quake/releases",
		);
	} finally {
		await owner.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it.each(["rejected promise", "missing browser handler"] as const)(
	"MAIN-114 keeps manual update checks and refreshed views after a %s",
	async (failure) => {
		const root = await mkdtemp(join(tmpdir(), "manual-update-launch-"));
		const prepared = prepareMaintenance({
			root,
			mock: false,
			fixture: { roots: [], descriptors: [], bundledDirectories: [] },
			renderer: "https://app.invalid",
			management: () => managementWindow,
			hardware: () => undefined,
			stopWriters: async () => {},
		});
		const owner = prepared.standalone();
		try {
			await owner.ready;
			const updates = await prepared.runtime.runPromise(AppUpdates);
			const check = vi.spyOn(updates, "check");
			const snapshot = vi.spyOn(updates, "snapshot");
			const cause = new Error("xdg-open unavailable");
			if (failure === "rejected promise")
				native.shell.openExternal.mockRejectedValueOnce(cause);
			else
				native.shell.openExternal.mockImplementationOnce(() => {
					throw cause;
				});
			const reply = await owner.request({ action: "check-update" });
			expect(reply).toMatchObject({
				ok: true,
				view: { appVersion: "1.0.0", update: { state: "disabled" } },
				message: expect.stringContaining("GitHub Releases"),
			});
			expect(reply).not.toHaveProperty("code");
			expect(native.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
				"https://github.com/ramarivera/open-quake/releases",
			);
			expect(check).toHaveBeenCalledOnce();
			// The initial state check and the returned view both sample the owner.
			expect(snapshot).toHaveBeenCalledTimes(2);
			expect(await owner.request({ action: "check-update" })).toMatchObject({
				ok: true,
			});
			expect(check).toHaveBeenCalledTimes(2);
		} finally {
			await owner.dispose();
			await rm(root, { recursive: true, force: true });
		}
	},
);

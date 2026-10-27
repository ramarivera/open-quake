import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { registerMaintenance } from "./index";

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
		management: () => undefined,
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
		management: () => undefined,
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

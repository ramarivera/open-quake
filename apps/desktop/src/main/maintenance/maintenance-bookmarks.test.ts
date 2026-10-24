import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { FirmwareWriteFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import * as files from "./firmware-files";
import * as sessions from "./firmware-session";
import { registerMaintenance } from "./index";

const native = vi.hoisted(() => ({
	app: {
		getVersion: () => "0.0.0",
		startAccessingSecurityScopedResource: vi.fn(() => vi.fn()),
	},
	dialog: {
		showMessageBox: vi.fn(async () => ({ response: 1 })),
		showOpenDialog: vi.fn(),
	},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
vi.mock("electron", () => native);
vi.mock("./permissions", () => ({
	nativePermissionChecks: async () => ({
		accessibility: () => true,
		inputMonitoring: () => false,
		microphone: () => true,
		screenRecording: () => false,
		systemAudio: () => undefined,
	}),
	permissionRows: () => [],
}));
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

for (const stage of [
	"hint",
	"start",
	"copy-failure",
	"copied",
	"dispose",
] as const) {
	it(`releases scoped bookmark exactly once at ${stage}`, async () => {
		const root = await realpath(
			await mkdtemp(join(tmpdir(), "bookmark-owner-")),
		);
		const volume = join(root, "QUAKE DFU");
		await mkdir(volume);
		const image = {
			fingerprint: "synthetic",
			version: "1.0.21",
			fileName: "synthetic.uf2",
			bytes: 1024,
			trusted: true,
		};
		const release = vi.fn();
		native.app.startAccessingSecurityScopedResource.mockReturnValueOnce(
			release,
		);
		native.dialog.showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: [volume],
			bookmarks: ["synthetic-bookmark"],
		});
		const copy = vi.fn(() =>
			stage === "copy-failure"
				? Effect.fail(new FirmwareWriteFailed())
				: Effect.void,
		);
		vi.spyOn(files, "firmwareFiles").mockReturnValueOnce({
			inspect: () => Effect.succeed(image),
			selected: () => Effect.succeed(image),
			discover: () =>
				Effect.succeed([{ id: "synthetic-volume", label: "QUAKE DFU" }]),
			pathFor: () => volume,
			copy,
		});
		const atomicJson = files.atomicJson;
		const store = sessions.firmwareSessionStore(
			join(root, "firmware-session-v1.json"),
		);
		vi.spyOn(sessions, "firmwareSessionStore").mockReturnValueOnce({
			...store,
			save: async (snapshot) => {
				if (stage === "start" && snapshot.state === "copying")
					throw new Error("synthetic save failure");
				await store.save(snapshot);
			},
		});
		if (stage === "hint")
			vi.spyOn(files, "atomicJson").mockImplementation(async (path, value) => {
				if (path.endsWith("firmware-volume-hint-v1.json"))
					throw new Error("synthetic hint failure");
				await atomicJson(path, value);
			});
		// Real firmware owner, fake file/device/permission ports. No HID or actual volume access.
		const owner = registerMaintenance({
			root,
			mock: false,
			fixture: { roots: [], descriptors: [] },
			renderer: "https://fixture.invalid",
			hardware: () => undefined,
			management: () => undefined,
			stopWriters: async () => {},
		});
		try {
			await owner.ready;
			expect(
				await owner.request({
					action: "firmware-recover",
					serial: "synthetic-quake",
				}),
			).toMatchObject({ ok: true });
			await vi.waitFor(async () =>
				expect(await owner.request({ action: "read" })).toMatchObject({
					ok: true,
					view: { firmware: { state: "ready_to_write" } },
				}),
			);
			if (stage === "copy-failure" || stage === "copied" || stage === "dispose")
				vi.useFakeTimers();
			const reply = await owner.request({
				action: "firmware-write",
				volumeId: "synthetic-volume",
			});
			if (stage === "hint" || stage === "start") {
				expect(reply.ok).toBe(false);
				expect(copy).not.toHaveBeenCalled();
				expect(release).toHaveBeenCalledOnce();
			} else {
				expect(reply.ok).toBe(true);
				expect(release).not.toHaveBeenCalled();
				if (stage !== "dispose") {
					await vi.advanceTimersByTimeAsync(2500);
					await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
					// Release follows copy, before a renderer poll or verification timeout.
					expect(release).toHaveBeenCalledOnce();
				}
			}
			await owner.dispose();
			await owner.dispose();
			expect(release).toHaveBeenCalledOnce();
			if (stage === "dispose") expect(copy).not.toHaveBeenCalled();
		} finally {
			await owner.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
}

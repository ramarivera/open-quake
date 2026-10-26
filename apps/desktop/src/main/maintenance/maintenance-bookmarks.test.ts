import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FirmwareWriteFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import * as files from "./firmware-files";
import * as sessions from "./firmware-session";
import { prepareMaintenance } from "./index";

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
const hostPlatform = process.platform;
beforeEach(() => {
	// Security-scoped bookmarks are a macOS capability. Exercise that branch
	// on every test host, rather than silently testing Linux's no-bookmark path.
	Object.defineProperty(process, "platform", { value: "darwin" });
});
afterEach(() => {
	Object.defineProperty(process, "platform", { value: hostPlatform });
	vi.useRealTimers();
	vi.restoreAllMocks();
});

for (const stage of [
	"hint",
	"start",
	"copy-failure",
	"copied",
	"dispose",
	"disposing-copy",
] as const) {
	it.each([false, true])(
		`releases scoped bookmark exactly once at ${stage}, shared=%s`,
		async (shared) => {
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
			native.app.startAccessingSecurityScopedResource
				.mockReset()
				.mockReturnValue(release);
			native.dialog.showOpenDialog.mockResolvedValue({
				canceled: false,
				filePaths: [volume],
				bookmarks: ["synthetic-bookmark"],
			});
			let finishCopy = () => {};
			const inFlight = new Promise<void>((resolve) => {
				finishCopy = resolve;
			});
			const copy = vi.fn(() =>
				stage === "disposing-copy"
					? Effect.promise(() => inFlight)
					: stage === "copy-failure"
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
				vi.spyOn(files, "atomicJson").mockImplementation(
					async (path, value) => {
						if (path.endsWith("firmware-volume-hint-v1.json"))
							throw new Error("synthetic hint failure");
						await atomicJson(path, value);
					},
				);
			// Real firmware owner, fake file/device/permission ports. No HID or actual volume access.
			const prepared = prepareMaintenance({
				root,
				mock: false,
				fixture: { roots: [], descriptors: [] },
				renderer: "https://fixture.invalid",
				hardware: () => undefined,
				management: () => undefined,
				stopWriters: async () => {},
			});
			const application = shared
				? makeDesktopRuntime(prepared.layer)
				: undefined;
			if (application) prepared.bind(application);
			const owner = application ? prepared.start() : prepared.standalone();
			const dispose = async () => {
				await owner.dispose();
				if (application) await application.dispose();
			};
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
				if (
					stage === "copy-failure" ||
					stage === "copied" ||
					stage === "dispose" ||
					stage === "disposing-copy"
				)
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
					if (shared && stage === "dispose") {
						await owner.dispose();
						expect(release).not.toHaveBeenCalled();
					}
					if (stage !== "dispose") {
						await vi.advanceTimersByTimeAsync(2500);
						await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
						if (stage === "disposing-copy") {
							let disposed = false;
							const disposal = dispose().then(() => {
								disposed = true;
							});
							await vi.advanceTimersByTimeAsync(10);
							expect(disposed).toBe(false);
							expect(release).not.toHaveBeenCalled();
							finishCopy();
							await disposal;
						}
						// Release follows copy, before a renderer poll or verification timeout.
						expect(release).toHaveBeenCalledOnce();
					}
				}
				await dispose();
				await dispose();
				expect(release).toHaveBeenCalledOnce();
				if (stage === "dispose") expect(copy).not.toHaveBeenCalled();
			} finally {
				finishCopy();
				await dispose();
				await rm(root, { recursive: true, force: true });
			}
		},
	);
}

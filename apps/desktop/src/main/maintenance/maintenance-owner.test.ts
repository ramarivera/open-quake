import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { clearOwnedData } from "./backup-store";
import { registerMaintenance } from "./index";

const native = vi.hoisted(() => ({
	app: { getVersion: () => "0.0.0", exit: vi.fn() },
	dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	shell: {},
}));
vi.mock("electron", () => native);
vi.mock("effect", async (original) => {
	const actual = await original<typeof import("effect")>();
	return {
		...actual,
		ManagedRuntime: {
			...actual.ManagedRuntime,
			make: vi.fn(actual.ManagedRuntime.make),
		},
	};
});
vi.mock("./backup-store", () => ({
	clearOwnedData: vi.fn(async (_root: string) => {}),
	exportBackup: vi.fn(),
	prepareRestore: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

for (const stage of ["stop", "clear", "report"] as const) {
	it(`reset exits with a scrubbed catalog failure when ${stage} fails`, async () => {
		const root = await mkdtemp(join(tmpdir(), "reset-owner-"));
		const cause = new Error("/synthetic/private?token=fixture-secret");
		const stop = vi.fn(async () => {
			if (stage === "stop") throw cause;
		});
		const exit = vi.fn();
		if (stage !== "stop")
			vi.mocked(clearOwnedData).mockRejectedValueOnce(cause);
		if (stage === "report")
			native.dialog.showMessageBox
				.mockResolvedValueOnce({ response: 1 })
				.mockRejectedValueOnce(new Error("report failed"));
		const owner = registerMaintenance({
			root,
			mock: true,
			renderer: "https://app.invalid",
			hardware: () => undefined,
			management: () => undefined,
			stopWriters: stop,
			exit,
		});
		try {
			await owner.ready;
			expect(
				await owner.request({ action: "reset", backup: false }),
			).toMatchObject({ ok: false, code: "QUAKE.SETTINGS.RESET_FAILED" });
			expect(stop).toHaveBeenCalledOnce();
			expect(exit).toHaveBeenCalledExactlyOnceWith(1);
			if (stage === "stop") expect(clearOwnedData).not.toHaveBeenCalled();
			else expect(clearOwnedData).toHaveBeenCalledExactlyOnceWith(root);
			const messages = JSON.stringify(native.dialog.showMessageBox.mock.calls);
			expect(messages).toContain("QUAKE.SETTINGS.RESET_FAILED");
			expect(messages).not.toMatch(/fixture-secret|synthetic\/private/);
		} finally {
			await owner.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
}

it("cancelled reset starts neither shutdown nor clear", async () => {
	const root = await mkdtemp(join(tmpdir(), "reset-cancel-"));
	const stop = vi.fn(async () => {});
	const exit = vi.fn();
	native.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://app.invalid",
		hardware: () => undefined,
		management: () => undefined,
		stopWriters: stop,
		exit,
	});
	try {
		await owner.ready;
		expect((await owner.request({ action: "reset", backup: false })).ok).toBe(
			true,
		);
		expect(stop).not.toHaveBeenCalled();
		expect(clearOwnedData).not.toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();
	} finally {
		await owner.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

for (const state of ["malformed", "unreadable"] as const) {
	it(`recovers ${state} firmware data without flashing and permits read, permission and reset`, async () => {
		const root = await mkdtemp(join(tmpdir(), "maintenance-recovery-"));
		const path = join(root, "firmware-session-v1.json");
		if (state === "malformed") await writeFile(path, "{invalid synthetic");
		else await mkdir(path);
		const stop = vi.fn(async () => {});
		const exit = vi.fn();
		const owner = registerMaintenance({
			root,
			mock: true,
			renderer: "https://app.invalid",
			hardware: () => undefined,
			management: () => undefined,
			stopWriters: stop,
			exit,
		});
		try {
			await expect(owner.ready).resolves.toBeUndefined();
			expect(await owner.request({ action: "read" })).toMatchObject({
				ok: true,
				view: { firmware: { state: "idle" } },
			});
			expect(
				await owner.request({ action: "permission", key: "accessibility" }),
			).toMatchObject({ ok: true });
			const retained = (await readdir(root)).find((name) =>
				name.startsWith("firmware-session-v1.json.recovery-"),
			);
			expect(retained).toBeDefined();
			if (state === "malformed" && retained)
				expect(await readFile(join(root, retained), "utf8")).toBe(
					"{invalid synthetic",
				);
			expect(
				await owner.request({ action: "reset", backup: false }),
			).toMatchObject({ ok: true });
			expect(stop).toHaveBeenCalledOnce();
			expect(exit).toHaveBeenCalledExactlyOnceWith(0);
		} finally {
			await owner.dispose().catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		}
	});
}

for (const backup of [false, true]) {
	it(`states the chosen reset backup mode and honors final cancellation: ${backup}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "reset-choice-"));
		const stop = vi.fn(async () => {});
		native.dialog.showMessageBox.mockResolvedValueOnce({ response: 0 });
		const owner = registerMaintenance({
			root,
			mock: true,
			renderer: "https://app.invalid",
			hardware: () => undefined,
			management: () => undefined,
			stopWriters: stop,
		});
		try {
			await owner.ready;
			expect(await owner.request({ action: "reset", backup })).toMatchObject({
				ok: true,
			});
			expect(native.dialog.showMessageBox).toHaveBeenCalledWith(
				expect.objectContaining({
					message: backup
						? "Back up, then clear all data and exit?"
						: "Clear all data and exit without a backup?",
					detail: expect.stringContaining("cannot be undone"),
				}),
			);
			expect(stop).not.toHaveBeenCalled();
			expect(clearOwnedData).not.toHaveBeenCalled();
		} finally {
			await owner.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
}

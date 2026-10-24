import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
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
	it(`disposes its runtime once after ${state} firmware initialization failure`, async () => {
		const root = await mkdtemp(join(tmpdir(), "maintenance-init-"));
		if (state === "malformed")
			await writeFile(
				join(root, "firmware-session-v1.json"),
				"{invalid synthetic",
			);
		else await mkdir(join(root, "firmware-session-v1.json"));
		const make = vi.spyOn(ManagedRuntime, "make");
		const owner = registerMaintenance({
			root,
			mock: true,
			renderer: "https://app.invalid",
			hardware: () => undefined,
			management: () => undefined,
			stopWriters: async () => {},
		});
		const runtime = make.mock.results[0];
		if (runtime?.type !== "return")
			throw new Error("Missing maintenance runtime");
		const dispose = vi.spyOn(runtime.value, "dispose");
		try {
			await expect(owner.ready).rejects.toMatchObject({
				name: expect.stringContaining("FirmwarePersistenceFailed"),
			});
			const first = owner.dispose();
			await expect(first).rejects.toBeDefined();
			expect(dispose).toHaveBeenCalledOnce();
			await expect(runtime.value.runPromise(Effect.void)).rejects.toBeDefined();
			expect(owner.dispose()).toBe(first);
			await expect(first).rejects.toBeDefined();
			expect(native.ipcMain.removeHandler).toHaveBeenCalledExactlyOnceWith(
				"maintenance:request",
			);
			await expect(owner.request({ action: "read" })).resolves.toMatchObject({
				ok: false,
				code: "QUAKE.SETTINGS.STOPPING",
			});
		} finally {
			await owner.dispose().catch(() => undefined);
			await rm(root, { recursive: true, force: true });
		}
	});
}

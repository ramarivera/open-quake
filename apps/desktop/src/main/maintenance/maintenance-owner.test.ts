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
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { createDesktopDiagnostics } from "../diagnostics";
import { clearOwnedData, prepareRestore } from "./backup-store";
import { prepareMaintenance, registerMaintenance } from "./index";

const native = vi.hoisted(() => ({
	app: { getVersion: () => "0.0.0", exit: vi.fn() },
	dialog: {
		showMessageBox: vi.fn(async () => ({ response: 1 })),
		showOpenDialog: vi.fn(async () => ({
			canceled: false,
			filePaths: [] as string[],
		})),
	},
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

it("a concurrent read can't dispose reset's runtime before its owning request finishes", async () => {
	const root = await mkdtemp(join(tmpdir(), "maintenance-concurrent-"));
	const diagnostics = createDesktopDiagnostics({
		directory: join(root, "diagnostics"),
	});
	const exit = vi.fn();
	native.dialog.showMessageBox.mockResolvedValue({ response: 1 });
	vi.mocked(clearOwnedData).mockResolvedValue();
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://app.invalid",
		management: () => undefined,
		hardware: () => undefined,
		stopWriters: async () => {},
		diagnostics,
		exit,
	});
	let releaseRead = () => {};
	let releaseReset = () => {};
	let readEntered = () => {};
	let resetEntered = () => {};
	const readGate = new Promise<void>((resolve) => {
		releaseRead = resolve;
	});
	const resetGate = new Promise<void>((resolve) => {
		releaseReset = resolve;
	});
	const readWaiting = new Promise<void>((resolve) => {
		readEntered = resolve;
	});
	const resetWaiting = new Promise<void>((resolve) => {
		resetEntered = resolve;
	});
	let read: Promise<unknown> | undefined;
	let reset: Promise<unknown> | undefined;
	try {
		await owner.ready;
		const runtime = vi.mocked(ManagedRuntime.make).mock.results.at(-1)?.value;
		if (!runtime) throw new Error("Maintenance runtime required");
		const dispose = vi.spyOn(runtime, "dispose");
		const instrument = diagnostics.instrument;
		let boundary = 0;
		vi.spyOn(diagnostics, "instrument").mockImplementation(
			(effect, operation) => {
				boundary++;
				const gate =
					boundary === 1
						? { entered: readEntered, wait: readGate }
						: boundary === 3
							? { entered: resetEntered, wait: resetGate }
							: undefined;
				return instrument(
					gate
						? effect.pipe(
								Effect.onExit(() =>
									Effect.promise(async () => {
										gate.entered();
										await gate.wait;
									}),
								),
							)
						: effect,
					operation,
				);
			},
		);
		read = owner.request({ action: "read" });
		await readWaiting;
		reset = owner.request({ action: "reset", backup: false });
		await resetWaiting;
		releaseRead();
		expect(
			await Promise.race([read.then(() => true), delay(100).then(() => false)]),
		).toBe(true);
		expect(dispose).not.toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();
		releaseReset();
		await reset;
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
	} finally {
		releaseRead();
		releaseReset();
		await Promise.allSettled([read, reset]);
		await owner.dispose();
		await diagnostics.close();
		await rm(root, { recursive: true, force: true });
	}
});

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

it("finishes reset spans and runtime finalizers before closing diagnostics and forcing exit", async () => {
	const root = await mkdtemp(join(tmpdir(), "maintenance-trace-"));
	const directory = join(root, "diagnostics");
	const diagnostics = createDesktopDiagnostics({ directory });
	const exit = vi.fn(async () => {
		await diagnostics.close();
		const lines = (
			await readFile(join(directory, "diagnostics.0.ndjson"), "utf8")
		)
			.trim()
			.split("\n")
			.map(
				(line) =>
					JSON.parse(line) as {
						type: string;
						span_name?: string;
						event?: string;
					},
			);
		expect(
			lines.some(
				(line) => line.type === "span" && line.span_name === "app.background",
			),
		).toBe(true);
		expect(lines.at(-1)?.event).toBe("diagnostics.shutdown");
	});
	native.dialog.showMessageBox.mockResolvedValue({ response: 1 });
	vi.mocked(clearOwnedData).mockResolvedValue();
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://app.invalid",
		management: () => undefined,
		hardware: () => undefined,
		stopWriters: async () => {},
		diagnostics,
		exit,
	});
	try {
		await owner.ready;
		await owner.request({ action: "reset", backup: false });
		expect(exit).toHaveBeenCalledExactlyOnceWith(0);
		expect(diagnostics.status()).toMatchObject({
			closed: true,
			dropped: 0,
			storageFailures: 0,
		});
	} finally {
		await owner.dispose();
		await diagnostics.close();
		await rm(root, { recursive: true, force: true });
	}
});

it.each(["reset", "import"] as const)(
	"unwinds %s before stopping the shared graph and replacing data",
	async (mode) => {
		const root = await mkdtemp(join(tmpdir(), "maintenance-graph-reset-"));
		const events: string[] = [];
		const diagnostics = createDesktopDiagnostics({
			directory: join(root, "diagnostics"),
		});

		const module = prepareMaintenance({
			root,
			mock: true,
			renderer: "https://app.invalid",
			hardware: () => undefined,
			management: () => undefined,
			diagnostics,
			stopWriters: async () => {
				events.push("stop");
				await application.dispose();
				events.push("stopped");
			},
			exit: async () => {
				events.push("exit");
			},
		});
		const resource = Layer.scopedDiscard(
			Effect.addFinalizer(() =>
				Effect.sync(() => {
					events.push("graph-finalizer");
				}),
			),
		);
		const application = ManagedRuntime.make(
			module.layer.pipe(Layer.provideMerge(resource)),
		);
		module.bind(application);
		const run = module.runtime.runPromise;
		vi.spyOn(module.runtime, "runPromise").mockImplementation(
			(effect, options) =>
				run(
					effect.pipe(
						Effect.onExit(() =>
							Effect.sync(() => {
								events.push("effect-finished");
							}),
						),
					),
					options,
				),
		);
		const owner = module.start();
		vi.mocked(clearOwnedData).mockImplementationOnce(async () => {
			events.push("clear");
		});
		try {
			await owner.ready;
			if (mode === "import") {
				const archive = join(root, "synthetic-backup.zip");
				await writeFile(archive, "synthetic");
				native.dialog.showOpenDialog.mockResolvedValueOnce({
					canceled: false,
					filePaths: [archive],
				});
				vi.mocked(prepareRestore).mockResolvedValueOnce({
					validate: async () => {},
					commit: async () => {
						events.push("clear");
						return { skipped: 0, imported: 0 };
					},
				});
			}
			const reply = await owner.request(
				mode === "reset" ? { action: mode, backup: false } : { action: mode },
			);
			expect(reply.ok).toBe(true);
			expect(events.lastIndexOf("effect-finished")).toBeLessThan(
				events.indexOf("stop"),
			);
			expect(events.indexOf("graph-finalizer")).toBeLessThan(
				events.indexOf("clear"),
			);
			expect(events).toContain("exit");
		} finally {
			await owner.dispose().catch(() => undefined);
			await application.dispose();
			await diagnostics.close();
			await rm(root, { recursive: true, force: true });
		}
	},
	1500,
);

import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { MaintenanceShutdownFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { createDesktopDiagnostics } from "../diagnostics";
import * as sessions from "./firmware-session";
import { registerMaintenance } from "./index";

const native = vi.hoisted(() => ({
	app: { getVersion: () => "0.0.0" },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
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
afterEach(() => vi.restoreAllMocks());

it("returns a typed reply on genuine initialization failure, disposes once and retains its private cause", async () => {
	const root = await mkdtemp(join(tmpdir(), "init-failure-"));
	const cause = new Error("/synthetic/private?token=fixture-secret");
	vi.spyOn(sessions, "firmwareSessionStore").mockReturnValueOnce({
		load: async () => {
			throw cause;
		},
		save: async () => {},
	});
	const make = vi.spyOn(ManagedRuntime, "make");
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://fixture.invalid",
		hardware: () => undefined,
		management: () => undefined,
		stopWriters: async () => {},
	});
	const runtime = make.mock.results[0];
	if (runtime?.type !== "return") throw new Error("Missing runtime");
	const dispose = vi.spyOn(runtime.value, "dispose");
	try {
		await expect(owner.ready).rejects.toMatchObject({
			name: expect.stringContaining("FirmwarePersistenceFailed"),
		});
		const readyFailure: unknown = await owner.ready.catch(
			(error: unknown) => error,
		);
		for (const action of ["read", "export", "reset"] as const) {
			const input = action === "reset" ? { action, backup: false } : { action };
			expect(await owner.request(input)).toEqual({
				ok: false,
				code: "QUAKE.FIRMWARE.PERSIST_FAILED",
			});
		}
		const first = owner.dispose();
		const error: unknown = await first.catch((failure: unknown) => failure);
		expect(error).toBeInstanceOf(MaintenanceShutdownFailed);
		if (
			!(error instanceof MaintenanceShutdownFailed) ||
			!(error.originalCause instanceof AggregateError)
		)
			throw new Error("Missing retained shutdown cause");
		expect(error.originalCause.errors).toContain(readyFailure);
		expect(JSON.stringify(error)).not.toMatch(
			/fixture-secret|synthetic\/private/,
		);
		expect(owner.dispose()).toBe(first);
		expect(dispose).toHaveBeenCalledOnce();
		await expect(runtime.value.runPromise(Effect.void)).rejects.toBeDefined();
		expect(await owner.request({ action: "read" })).toEqual({
			ok: false,
			code: "QUAKE.SETTINGS.STOPPING",
		});
	} finally {
		await owner.dispose().catch(() => undefined);
		await rm(root, { recursive: true, force: true });
	}
});

it("persists firmware recovery failures through the production diagnostics owner", async () => {
	const root = await mkdtemp(join(tmpdir(), "firmware-diagnostics-"));
	const diagnosticRoot = join(root, "diagnostics");
	const diagnostics = createDesktopDiagnostics({ directory: diagnosticRoot });
	await writeFile(
		join(root, "firmware-session-v1.json"),
		'{"private":"fixture-firmware-secret",broken',
	);
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://fixture.invalid",
		hardware: () => undefined,
		management: () => undefined,
		stopWriters: async () => {},
		diagnostics,
	});
	try {
		await owner.ready;
		await owner.dispose();
		await diagnostics.close();
		const saved = await readFile(
			join(diagnosticRoot, "diagnostics.0.ndjson"),
			"utf8",
		);
		const rows: Record<string, unknown>[] = saved
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const failed = rows.find(
			(row) =>
				row.type === "span" &&
				row.span_name === "FirmwareSession.load" &&
				row.outcome === "failure",
		);
		expect(failed).toMatchObject({
			request_id: expect.any(String),
			trace_id: expect.any(String),
			cause: {
				kind: "Fail",
				error: {
					code: "QUAKE.FIRMWARE.PERSIST_FAILED",
					_tag: "FirmwarePersistenceFailed",
					cause: { name: "Error" },
				},
			},
		});
		expect(
			rows.some(
				(row) =>
					row.type === "log" &&
					row.event === "Firmware session requires recovery",
			),
		).toBe(true);
		expect(rows.at(-1)).toMatchObject({
			type: "health",
			dropped: 0,
			storageFailures: 0,
		});
		expect(saved).not.toContain("fixture-firmware-secret");
		expect(saved).not.toContain(root);
	} finally {
		await owner.dispose().catch(() => undefined);
		await diagnostics.close();
		await rm(root, { recursive: true, force: true });
	}
});

it("keeps Settings available and logs a scrubbed diagnostic when an optional bundled directory is unreadable", async () => {
	const root = await mkdtemp(join(tmpdir(), "unreadable-bundle-"));
	const directory = join(root, "private-fixture-secret");
	await mkdir(directory, { mode: 0o000 });
	const diagnosticRoot = join(root, "diagnostics");
	const diagnostics = createDesktopDiagnostics({ directory: diagnosticRoot });
	const owner = registerMaintenance({
		root,
		mock: true,
		renderer: "https://fixture.invalid",
		hardware: () => undefined,
		management: () => undefined,
		stopWriters: async () => {},
		diagnostics,
		fixture: {
			roots: [],
			descriptors: [],
			bundledDirectories: [directory, join(root, "missing")],
		},
	});
	try {
		await owner.ready;
		expect(await owner.request({ action: "read" })).toMatchObject({
			ok: true,
			view: { firmwareAvailability: "no_device" },
		});
		await owner.dispose();
		await diagnostics.close();
		const saved = await readFile(
			join(diagnosticRoot, "diagnostics.0.ndjson"),
			"utf8",
		);
		expect(saved).toContain("Optional bundled firmware unavailable");
		expect(saved).toContain("QUAKE.FIRMWARE.IMAGE_INVALID");
		expect(saved).not.toContain(directory);
		expect(saved).not.toContain("private-fixture-secret");
	} finally {
		await owner.dispose().catch(() => undefined);
		await diagnostics.close();
		await chmod(directory, 0o700);
		await rm(root, { recursive: true, force: true });
	}
});

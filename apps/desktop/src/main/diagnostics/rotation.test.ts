import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createDiagnosticStorage } from "./persistence";

it("MAIN-126 rotates across local midnight and retains ordered private files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "shell-logs-"));
	let time = new Date(2026, 9, 26, 23, 59, 59);
	const storage = createDiagnosticStorage({ directory, now: () => time });
	try {
		storage.emit({ sequence: 1 });
		await storage.flush();
		time = new Date(2026, 9, 27, 0, 0, 0);
		storage.emit({ sequence: 2 });
		storage.emit({ sequence: 3 });
		await storage.close();
		expect(
			await readFile(join(directory, "diagnostics.1.ndjson"), "utf8"),
		).toBe('{"sequence":1}\n');
		expect(
			await readFile(join(directory, "diagnostics.0.ndjson"), "utf8"),
		).toBe('{"sequence":2}\n{"sequence":3}\n');
		expect(
			(await stat(join(directory, "diagnostics.0.ndjson"))).mode & 0o777,
		).toBe(0o600);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
	} finally {
		await storage.close();
		await rm(directory, { recursive: true, force: true });
	}
});

it("MAIN-126 defaults to the exact 10 MiB boundary and retains thirty files", async () => {
	const directory = await mkdtemp(join(tmpdir(), "shell-log-size-"));
	const storage = createDiagnosticStorage({
		directory,
		maxQueueBytes: 2 * 1024 * 1024,
	});
	const line = { payload: "x".repeat(1024 * 1024 - 15) };
	try {
		for (let i = 0; i < 10; i++) {
			storage.emit(line);
			await storage.flush();
		}
		expect(await readdir(directory)).toEqual(["diagnostics.0.ndjson"]);
		storage.emit({ a: "boundary" });
		await storage.flush();
		expect((await readdir(directory)).length).toBe(2);
		await storage.close();
		let date = new Date(2026, 0, 1);
		const daily = createDiagnosticStorage({ directory, now: () => date });
		for (let i = 0; i < 35; i++) {
			date = new Date(2026, 0, i + 1);
			daily.emit({ i });
			await daily.flush();
		}
		await daily.close();
		expect((await readdir(directory)).length).toBe(30);
		expect(
			await readFile(join(directory, "diagnostics.0.ndjson"), "utf8"),
		).toBe('{"i":34}\n');
	} finally {
		await storage.close();
		await rm(directory, { recursive: true, force: true });
	}
});

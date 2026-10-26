import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import { mediaProcess } from "./process";

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
describe("native media child lifecycle", () => {
	it("bounds output and preserves the native overflow cause privately", async () => {
		const result = await Effect.runPromise(
			Effect.either(
				mediaProcess(process.execPath, [
					"-e",
					"process.stdout.write('x'.repeat(5*1024*1024))",
				]),
			),
		);
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isLeft(result)) {
			expect(result.left.code).toBe("QUAKE.MEDIA.PROCESS_FAILED");
			expect(result.left.originalCause).toMatchObject({
				code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
			});
			expect(JSON.stringify(result.left)).not.toContain("xxxx");
		}
	});
	it("kills a stalled child at the five-second deadline", async () => {
		const start = performance.now();
		const result = await Effect.runPromise(
			Effect.either(
				mediaProcess(process.execPath, [
					"-e",
					"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
				]),
			),
		);
		expect(Either.isLeft(result) && result.left.originalCause).toMatchObject({
			killed: true,
			signal: "SIGKILL",
		});
		expect(performance.now() - start).toBeGreaterThanOrEqual(4800);
		expect(performance.now() - start).toBeLessThan(9000);
	}, 12000);
	it("awaits termination on interruption and isolates inherited secrets", async () => {
		const directory = await mkdtemp(join(tmpdir(), "media-process-"));
		const path = join(directory, "pid");
		const child = Effect.runFork(
			mediaProcess(
				process.execPath,
				[
					"-e",
					"require('node:fs').writeFileSync(process.env.OPEN_QUAKE_MEDIA_PID_FILE,String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
				],
				{ OPEN_QUAKE_MEDIA_PID_FILE: path },
			),
		);
		try {
			let pid = 0;
			await vi.waitFor(async () => {
				pid = Number(await readFile(path, "utf8"));
				expect(pid).toBeGreaterThan(0);
			});
			expect(alive(pid)).toBe(true);
			await Effect.runPromise(Fiber.interrupt(child));
			expect(alive(pid)).toBe(false);
			vi.stubEnv("OPEN_QUAKE_PRIVATE_MEDIA_TEST", "PRIVATE_SENTINEL");
			const output = await Effect.runPromise(
				mediaProcess(process.execPath, [
					"-e",
					"process.stdout.write(process.env.OPEN_QUAKE_PRIVATE_MEDIA_TEST ?? 'absent')",
				]),
			);
			expect(output).toBe("absent");
		} finally {
			vi.unstubAllEnvs();
			await Effect.runPromise(Fiber.interrupt(child));
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("keeps missing-executable identity without exposing argv", async () => {
		const result = await Effect.runPromise(
			Effect.either(
				mediaProcess("/nonexistent/open-quake-media-helper", ["PRIVATE_ARGV"]),
			),
		);
		expect(Either.isLeft(result) && result.left.originalCause).toMatchObject({
			code: "ENOENT",
		});
		expect(JSON.stringify(result)).not.toContain("PRIVATE_ARGV");
	});
});

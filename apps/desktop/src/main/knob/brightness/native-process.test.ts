import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Fiber } from "effect";
import { expect, it } from "vitest";
import { brightnessProcess } from "./native-process";

it("bounds stdout and retains native process causes", async () => {
	const result = await Effect.runPromise(
		Effect.either(
			brightnessProcess(process.execPath, [
				"-e",
				"process.stdout.write('x'.repeat(8192))",
			]),
		),
	);
	expect(Either.isLeft(result) && result.left._tag).toBe("KnobDispatchFailed");
	expect(
		Either.isLeft(result) &&
			Reflect.get(result.left.originalCause as object, "code"),
	).toBe("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
});
it("kills an interrupted native process and leaves no child running", async () => {
	const directory = await mkdtemp(join(tmpdir(), "brightness-process-"));
	const pidFile = join(directory, "pid");
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				const source =
					"require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);";
				const fiber = yield* Effect.fork(
					brightnessProcess(process.execPath, ["-e", source, pidFile]),
				);
				const start = Date.now();
				let pid = 0;
				while (Date.now() - start < 3000 && !pid) {
					const result = yield* Effect.tryPromise({
						try: () => readFile(pidFile, "utf8"),
						catch: () => undefined,
					}).pipe(Effect.either);
					if (Either.isRight(result)) pid = Number(result.right);
					else yield* Effect.sleep("10 millis");
				}
				expect(pid).toBeGreaterThan(0);
				yield* Fiber.interrupt(fiber);
				let alive = true;
				const deadline = Date.now() + 1000;
				while (alive && Date.now() < deadline) {
					try {
						process.kill(pid, 0);
					} catch {
						alive = false;
					}
					if (alive) yield* Effect.sleep("10 millis");
				}
				expect(alive).toBe(false);
			}),
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
it("enforces its deadline even when a child ignores SIGTERM", async () => {
	const start = Date.now();
	const result = await Effect.runPromise(
		Effect.either(
			brightnessProcess(process.execPath, [
				"-e",
				"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
			]),
		),
	);
	expect(Either.isLeft(result) && result.left._tag).toBe("KnobDispatchFailed");
	expect(Date.now() - start).toBeLessThan(6500);
}, 8000);

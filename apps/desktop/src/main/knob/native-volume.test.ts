import { execFile } from "node:child_process";
import { Effect, Either, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors.js";
import { readNativeVolume, script } from "./native-volume";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

describe("native volume boundary fixtures", () => {
	it.each([
		["0, true", 0, true],
		["100, false", 100, false],
		["51, true", 51, true],
	] as const)("decodes %s without a write", async (fixture, level, muted) => {
		const run = vi.fn(() => Effect.succeed(fixture));
		expect(await Effect.runPromise(readNativeVolume(run))).toEqual({
			level,
			muted,
		});
		expect(run).toHaveBeenCalledExactlyOnceWith(
			"get {output volume, output muted} of (get volume settings)",
		);
	});
	it.each([
		"101, false",
		"-1, false",
		"50, nope",
		"",
		"50, false\nprivate",
		"12.5, false",
	])("rejects invalid response %s", async (fixture) => {
		const result = await Effect.runPromise(
			readNativeVolume(() => Effect.succeed(fixture)).pipe(Effect.either),
		);
		expect(Either.isLeft(result) && result.left.code).toBe(
			"QUAKE.KNOB.DISPATCH_FAILED",
		);
	});
	it("retains the actual process failure privately and bounds process IO", async () => {
		const source = Object.assign(
			new Error("/private/path token=secret device-private"),
			{ code: "EACCES" },
		);
		const kill = vi.fn();
		vi.mocked(execFile).mockImplementationOnce(
			(_file, _args, _options, callback) => {
				if (typeof callback === "function") callback(source, "", "");
				return { kill } as unknown as ReturnType<typeof execFile>;
			},
		);
		if (process.platform !== "darwin") return;
		const result = await Effect.runPromise(
			script("read-only-fixture").pipe(Effect.either),
		);
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isLeft(result)) {
			expect(result.left).toBeInstanceOf(KnobDispatchFailed);
			expect(result.left.originalCause).toBe(source);
			expect(JSON.stringify(result.left)).not.toMatch(/private|secret/);
		}
		expect(execFile).toHaveBeenCalledWith(
			"/usr/bin/osascript",
			["-e", "read-only-fixture"],
			{ timeout: 3000, maxBuffer: 4096 },
			expect.any(Function),
		);
	});
	it.skipIf(process.platform !== "darwin")(
		"translates synchronous spawn failures and kills interrupted child reads",
		async () => {
			const source = Object.assign(new Error("private spawn arguments"), {
				code: "EACCES",
			});
			vi.mocked(execFile).mockImplementationOnce(() => {
				throw source;
			});
			const failure = await Effect.runPromise(
				script("fixture").pipe(Effect.either),
			);
			expect(Either.isLeft(failure) && failure.left.originalCause).toBe(source);
			const kill = vi.fn();
			vi.mocked(execFile).mockImplementationOnce(
				() => ({ kill }) as unknown as ReturnType<typeof execFile>,
			);
			const child = Effect.runFork(script("fixture"));
			await vi.waitFor(() => expect(execFile).toHaveBeenCalledTimes(2));
			await Effect.runPromise(Fiber.interrupt(child));
			expect(kill).toHaveBeenCalledOnce();
		},
	);
});

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors.js";
import { createDesktopDiagnostics } from "../diagnostics";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import { readNativeVolume } from "./native-volume";

vi.mock("electron", () => ({ app: {}, ipcMain: {}, nativeImage: {} }));

describe("knob production failure diagnostics", () => {
	it("completes correlated spans with catalog/source identities and no raw native text", async () => {
		const directory = await mkdtemp(
			join(
				process.env.OPEN_QUAKE_TEST_SCRATCH ?? tmpdir(),
				"knob-diagnostics-",
			),
		);
		const diagnostics = createDesktopDiagnostics({ directory });
		const runtime = makeDesktopRuntime(Layer.empty, diagnostics);
		const source = Object.assign(
			new Error("/Users/private/Desktop token=secret serial-private"),
			{ code: "EACCES" },
		);
		try {
			const result = await runtime.runPromise(
				readNativeVolume(() =>
					Effect.fail(KnobDispatchFailed.fromCause(source)),
				).pipe(Effect.either),
			);
			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result)) expect(result.left.originalCause).toBe(source);
			await runtime.dispose();
			await diagnostics.close();
			const lines = (
				await Promise.all(
					(
						await readdir(directory)
					)
						.filter((file) => file.endsWith(".ndjson"))
						.map((file) => readFile(join(directory, file), "utf8")),
				)
			)
				.join("\n")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			const failed = lines.find(
				(line) => line.type === "span" && line.outcome === "failure",
			);
			expect(failed).toMatchObject({
				duration_ms: expect.any(Number),
				trace_id: expect.any(String),
				request_id: expect.any(String),
				cause: {
					kind: "Fail",
					error: {
						_tag: "KnobDispatchFailed",
						code: "QUAKE.KNOB.DISPATCH_FAILED",
						cause: { name: "Error", sourceCode: "EACCES" },
					},
				},
			});
			const outer = lines.find((line) => line.span_name === "app.background");
			expect(failed?.trace_id).toBe(outer?.trace_id);
			expect(failed?.parent_span_id).toBe(outer?.span_id);
			expect(failed?.request_id).toBe(outer?.request_id);
			expect(JSON.stringify(lines)).not.toMatch(
				/\/Users\/private|token=|secret|serial-private/,
			);
		} finally {
			await runtime.dispose();
			await diagnostics.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});

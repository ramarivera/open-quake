import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Either, Layer, ManagedRuntime, Schema } from "effect";
import { expect, it } from "vitest";
import { AudioOutput } from "../../../../../packages/edge/src/audio/output-service.js";
import { SoundboardPlayer } from "../../../../../packages/edge/src/soundboard/playback-ports.js";
import {
	SoundboardDecodeFailed,
	SoundboardLoadTimeout,
} from "../../../../../packages/edge/src/soundboard/soundboard-errors.js";
import { SoundboardFiles } from "../../../../../packages/edge/src/soundboard/soundboard-ports.js";
import { SoundboardService } from "../../../../../packages/edge/src/soundboard/soundboard-service.js";
import { createDesktopDiagnostics } from "../diagnostics/index.js";

it("persists the real conductor/player failure in one scrubbed trace and exposes truthful failed state", async () => {
	const directory = await mkdtemp(join(tmpdir(), "oq-playback-diagnostics-"));
	const original = Object.assign(
		new Error("/private/music/song.mp3 Bearer secret"),
		{ code: "EACCES" },
	);
	const failure = new SoundboardDecodeFailed(original);
	const diagnostics = createDesktopDiagnostics({ directory });
	const runtime = ManagedRuntime.make(
		SoundboardService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					AudioOutput.Default,
					Layer.succeed(SoundboardFiles, {
						inspect: () => Effect.succeed("available" as const),
					}),
					Layer.succeed(SoundboardPlayer, {
						open: Effect.fn("SoundboardPlayer.open")(() =>
							Effect.fail(failure),
						),
					}),
				),
			),
			Layer.provideMerge(diagnostics.layer),
		),
	);
	try {
		const result = await runtime.runPromise(
			diagnostics
				.instrument(
					SoundboardService.play(
						{ profileId: "synthetic-profile", keyCode: "1" },
						{
							revision: 1,
							entries: [
								{
									fileId: "a",
									path: "/private/music/song.mp3",
									status: "available",
								},
							],
							volume: 50,
							fade: { mode: "none", durationMs: 0 },
						},
					),
					"app.background",
				)
				.pipe(Effect.either),
		);
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isLeft(result))
			expect(Cause.originalError(result.left)).toBe(failure);
		expect(failure.originalCause).toBe(original);
		expect(
			await runtime.runPromise(SoundboardService.snapshot()),
		).toMatchObject([{ state: "failed", errorCode: failure.code }]);
		await runtime.dispose();
		await diagnostics.close();
		const raw = (
			await Promise.all(
				(
					await readdir(directory)
				)
					.filter((file) => file.endsWith(".ndjson"))
					.map((file) => readFile(join(directory, file), "utf8")),
			)
		).join("\n");
		const records = raw
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const conductor = records.find(
			(record) =>
				record.span_name === "SoundboardService.play" &&
				record.outcome === "failure",
		);
		const player = records.find(
			(record) =>
				record.span_name === "SoundboardPlayer.open" &&
				record.outcome === "failure",
		);
		expect(conductor).toMatchObject({
			cause: {
				kind: "Fail",
				error: {
					_tag: "SoundboardDecodeFailed",
					code: failure.code,
					cause: { sourceCode: "EACCES" },
				},
			},
		});
		expect(player?.trace_id).toBe(conductor?.trace_id);
		expect(player?.parent_span_id).toBe(conductor?.span_id);
		expect(player?.request_id).toBe(conductor?.request_id);
		expect(typeof conductor?.trace_id).toBe("string");
		expect(raw).not.toMatch(/private|music|Bearer|secret|song/);
	} finally {
		await runtime.dispose();
		await diagnostics.close();
		await rm(directory, { recursive: true, force: true });
	}
});

it.each([SoundboardDecodeFailed, SoundboardLoadTimeout])(
	"round-trips playback catalog error %s without exposing its original cause",
	(ErrorType) => {
		const original = Object.assign(
			new Error("/private/music.mp3 token=secret"),
			{ code: "EACCES" },
		);
		const failure = new ErrorType(original);
		const raw = JSON.stringify(failure);
		const decoded = Schema.decodeUnknownSync(
			Schema.Union(SoundboardDecodeFailed, SoundboardLoadTimeout),
		)(JSON.parse(raw));
		expect(decoded).toBeInstanceOf(ErrorType);
		expect(decoded.code).toBe(failure.code);
		expect(failure.originalCause).toBe(original);
		expect(decoded.originalCause).toBeUndefined();
		expect(raw).not.toMatch(/private|music|secret/);
	},
);

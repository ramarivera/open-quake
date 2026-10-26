import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { MeetingErrorSchema } from "../../../../../packages/edge/src/meetings/meeting-errors";

const converter = vi.hoisted(() => ({
	output: " A....D libmp3lame MP3 encoder",
	error: undefined as Error | undefined,
	code: 0,
	probeTimeout: false,
}));
vi.mock("node:child_process", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		spawn: vi.fn((_executable: string, args: string[]) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
			});
			queueMicrotask(() => {
				if (
					args.includes("null") &&
					(converter.probeTimeout || !args.includes("-t"))
				)
					child.emit("exit", null, "SIGTERM");
				else if (converter.error) child.emit("error", converter.error);
				else {
					child.stdout.emit("data", Buffer.from(converter.output));
					child.emit("exit", converter.code);
				}
			});
			return child;
		}),
	};
});

import { spawn } from "node:child_process";
import { audioFiles } from "./audio-files";

afterEach(() => {
	converter.output = " A....D libmp3lame MP3 encoder";
	converter.error = undefined;
	converter.code = 0;
	converter.probeTimeout = false;
	vi.clearAllMocks();
});
it("accepts an MP3-capable converter with a bounded, non-recording probe", async () => {
	await Effect.runPromise(audioFiles("unused", "/chosen/ffmpeg").ready());
	expect(spawn).toHaveBeenCalledWith(
		"/chosen/ffmpeg",
		["-hide_banner", "-encoders"],
		expect.objectContaining({ timeout: 8000 }),
	);
});
it.each(["missing", "failed", "no-encoder"])(
	"reports an actionable typed error for a %s converter",
	async (failure) => {
		if (failure === "missing")
			converter.error = Object.assign(new Error("private executable path"), {
				code: "ENOENT",
			});
		if (failure === "failed") converter.code = 1;
		if (failure === "no-encoder") converter.output = " A....D pcm_s16le PCM";
		const result = await Effect.runPromise(
			Effect.either(audioFiles("unused", "ffmpeg").ready()),
		);
		if (Either.isRight(result)) throw new Error("Expected converter rejection");
		expect(result.left.code).toBe("QUAKE.MEETING.CONVERTER_UNAVAILABLE");
		expect(result.left.message).toContain("Install it");
		expect(Schema.is(MeetingErrorSchema)(result.left)).toBe(true);
		if (failure === "missing") {
			expect(result.left.originalCause).toBe(converter.error);
			expect(JSON.stringify(result.left)).not.toContain(
				"private executable path",
			);
		}
	},
);

for (const timeout of [false, true]) {
	it(`does not discard valid system audio on a slow validation, timeout=${timeout}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "oq-system-probe-"));
		const id = "00000000-0000-4000-8000-000000000111";
		const { meetingDirectory } = await import("./private-files");
		const directory = await meetingDirectory(root, id);
		try {
			await writeFile(join(directory, "mic_0.webm"), "fake mic");
			await writeFile(
				join(directory, "system_0.webm"),
				"fake long system audio",
			);
			converter.probeTimeout = timeout;
			const result = await Effect.runPromise(
				Effect.either(audioFiles(root, "ffmpeg").finalize(id)),
			);
			if (timeout) {
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.MEETING.CAPTURE_FAILED",
				);
				expect(
					vi
						.mocked(spawn)
						.mock.calls.some(([, args]) => args.includes("-filter_complex")),
				).toBe(false);
			} else {
				expect(Either.isRight(result)).toBe(true);
				expect(
					vi
						.mocked(spawn)
						.mock.calls.some(
							([, args]) =>
								args.includes("-filter_complex") &&
								args.includes(join(directory, "system_0.webm")),
						),
				).toBe(true);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

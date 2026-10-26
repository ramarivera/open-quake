import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import type { CaptureChunk } from "../../shared/meeting-bridge";
import {
	meetingDirectory,
	privateOutput,
	writePrivateFile,
} from "./private-files";

const run = (executable: string, args: readonly string[], timeout?: number) =>
	Effect.tryPromise({
		try: (signal) =>
			new Promise<string>((resolve, reject) => {
				let output = "";
				const process = spawn(executable, [...args], {
					stdio: ["ignore", "pipe", "ignore"],
					timeout,
					signal,
				});
				process.stdout.on("data", (chunk: Buffer) => {
					output = (output + chunk.toString("utf8")).slice(-16384);
				});
				process.once("error", reject);
				process.once("exit", (code) =>
					code === 0
						? resolve(output)
						: reject(new Error("Audio conversion failed")),
				);
			}),
		catch: (cause) => meetingError("CaptureFailed", cause),
	});
export function audioFiles(root: string, ffmpeg: string) {
	return {
		ready: () =>
			run(ffmpeg, ["-hide_banner", "-encoders"], 8000).pipe(
				Effect.mapError((error) =>
					meetingError("ConverterUnavailable", error.originalCause),
				),
				Effect.flatMap((output) =>
					/\blibmp3lame\b/.test(output)
						? Effect.void
						: Effect.fail(meetingError("ConverterUnavailable")),
				),
			),
		write: (chunk: CaptureChunk) =>
			Effect.tryPromise({
				try: async () => {
					const directory = await meetingDirectory(root, chunk.id);
					const file = await open(
						join(directory, `${chunk.track}_${chunk.segment}.webm`),
						constants.O_APPEND |
							constants.O_CREAT |
							constants.O_WRONLY |
							constants.O_NOFOLLOW,
						0o600,
					);
					try {
						await file.chmod(0o600);
						await file.writeFile(chunk.bytes);
					} finally {
						await file.close();
					}
				},
				catch: (cause) => meetingError("StorageFailed", cause),
			}),
		duration: (id: string) =>
			Effect.gen(function* () {
				const directory = yield* Effect.tryPromise({
					try: () => meetingDirectory(root, id),
					catch: (cause) => meetingError("CaptureFailed", cause),
				});
				const progress = yield* run(ffmpeg, [
					"-nostdin",
					"-i",
					join(directory, "final_recording.mp3"),
					"-f",
					"null",
					"-",
					"-progress",
					"pipe:1",
				]);
				const elapsed =
					Number([...progress.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1]) /
					1000;
				if (!Number.isFinite(elapsed) || elapsed < 0)
					return yield* meetingError("CaptureFailed");
				return elapsed;
			}),
		finalize: (id: string) =>
			Effect.gen(function* () {
				const directory = yield* Effect.tryPromise({
					try: () => meetingDirectory(root, id),
					catch: (cause) => meetingError("CaptureFailed", cause),
				});
				const names = yield* Effect.tryPromise({
					try: () => readdir(directory),
					catch: (cause) => meetingError("CaptureFailed", cause),
				});
				const segments = names
					.filter((name) => /^mic_\d+\.webm$/.test(name))
					.sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)));
				if (!segments.length) return yield* meetingError("CaptureFailed");
				const merged: string[] = [];
				for (const name of segments) {
					const index = name.slice(4, -5),
						output = `merged_${index}.mp3`;
					const inputs = ["-y", "-i", join(directory, name)];
					const system = `system_${index}.webm`;
					const systemPath = join(directory, system);
					const usable =
						names.includes(system) &&
						(yield* Effect.tryPromise({
							try: async () => {
								const stat = await lstat(systemPath);
								return stat.isFile() && stat.size > 0;
							},
							catch: (cause) => meetingError("CaptureFailed", cause),
						}));
					const validSystem =
						usable &&
						(yield* run(
							ffmpeg,
							["-nostdin", "-v", "error", "-i", systemPath, "-f", "null", "-"],
							8000,
						).pipe(
							Effect.as(true),
							Effect.catchTag("MeetingCaptureFailed", () =>
								Effect.succeed(false),
							),
						));
					if (validSystem)
						inputs.push(
							"-i",
							join(directory, system),
							"-filter_complex",
							"[0:a]aresample=48000[a];[1:a]aresample=48000[b];[a][b]amix=inputs=2:duration=longest",
						);
					yield* Effect.tryPromise({
						try: () => privateOutput(join(directory, output)),
						catch: (cause) => meetingError("CaptureFailed", cause),
					});
					yield* run(ffmpeg, [
						...inputs,
						"-ar",
						"48000",
						"-ac",
						"1",
						"-sample_fmt",
						"s16p",
						"-codec:a",
						"libmp3lame",
						join(directory, output),
					]);
					merged.push(output);
				}
				yield* Effect.tryPromise({
					try: () =>
						writePrivateFile(
							join(directory, "filelist.txt"),
							merged.map((name) => `file '${name}'`).join("\n"),
						),
					catch: (cause) => meetingError("StorageFailed", cause),
				});
				yield* Effect.tryPromise({
					try: () => privateOutput(join(directory, "final_recording.mp3")),
					catch: (cause) => meetingError("CaptureFailed", cause),
				});
				yield* run(ffmpeg, [
					"-y",
					"-f",
					"concat",
					"-safe",
					"1",
					"-i",
					join(directory, "filelist.txt"),
					"-c",
					"copy",
					join(directory, "final_recording.mp3"),
				]);
			}),
	};
}

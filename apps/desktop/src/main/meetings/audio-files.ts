import { spawn } from "node:child_process";
import { appendFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import type { CaptureChunk } from "../../shared/meeting-bridge";

const run = (executable: string, args: readonly string[]) =>
	Effect.tryPromise({
		try: (signal) =>
			new Promise<void>((resolve, reject) => {
				const process = spawn(executable, [...args], {
					stdio: "ignore",
					signal,
				});
				process.once("error", reject);
				process.once("exit", (code) =>
					code === 0 ? resolve() : reject(new Error("Audio conversion failed")),
				);
			}),
		catch: (cause) => meetingError("CaptureFailed", cause),
	});
export function audioFiles(root: string, ffmpeg: string) {
	return {
		write: (chunk: CaptureChunk) =>
			Effect.tryPromise({
				try: async () => {
					const directory = join(root, chunk.id);
					await mkdir(directory, { recursive: true, mode: 0o700 });
					await appendFile(
						join(directory, `${chunk.track}_${chunk.segment}.webm`),
						chunk.bytes,
						{ mode: 0o600 },
					);
				},
				catch: (cause) => meetingError("StorageFailed", cause),
			}),
		finalize: (id: string) =>
			Effect.gen(function* () {
				const directory = join(root, id);
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
					if (names.includes(system))
						inputs.push(
							"-i",
							join(directory, system),
							"-filter_complex",
							"[0:a]aresample=48000[a];[1:a]aresample=48000[b];[a][b]amix=inputs=2:duration=longest",
						);
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
						writeFile(
							join(directory, "filelist.txt"),
							merged.map((name) => `file '${name}'`).join("\n"),
							{ mode: 0o600 },
						),
					catch: (cause) => meetingError("StorageFailed", cause),
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

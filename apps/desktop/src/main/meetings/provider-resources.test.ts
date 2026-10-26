import type { SpawnOptions } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Fiber, Stream } from "effect";
import { expect, it, vi } from "vitest";

const converter = vi.hoisted(() => ({
	failure: "corrupt",
	attempts: 0,
	entered: () => {},
	aborted: false,
}));
vi.mock("node:child_process", async () => {
	const { EventEmitter } = await import("node:events");
	return {
		spawn: vi.fn(
			(_executable: string, args: string[], options: SpawnOptions) => {
				const child = new EventEmitter();
				converter.attempts++;
				queueMicrotask(() => {
					if (converter.failure === "blocked") {
						const output = args.at(-1);
						if (!output) throw new Error("Missing output");
						void writeFile(output, new Uint8Array([1, 2])).then(() =>
							converter.entered(),
						);
						options.signal?.addEventListener(
							"abort",
							() => {
								converter.aborted = true;
								child.emit("error", new Error("aborted"));
								child.emit("close", 1);
							},
							{ once: true },
						);
					} else if (
						converter.failure === "slow" &&
						options.timeout &&
						options.timeout < 121000
					)
						child.emit("close", 1);
					else if (converter.failure === "slow") {
						const output = args.at(-1);
						if (!output) throw new Error("Missing output");
						void writeFile(output, new Uint8Array([1, 2])).then(() =>
							child.emit("close", 0),
						);
					} else if (converter.failure === "corrupt") child.emit("close", 1);
					else if (converter.attempts === 1 || converter.failure !== "EAGAIN")
						child.emit(
							"error",
							Object.assign(new Error("fake spawn failure"), {
								code: converter.failure,
							}),
						);
					else {
						const output = args.at(-1);
						if (!output) throw new Error("Missing output");
						void writeFile(output, new Uint8Array([1, 2])).then(
							() => child.emit("close", 0),
							(error) => child.emit("error", error),
						);
					}
				});
				return child;
			},
		),
	};
});

import { meetingDirectory } from "./private-files";
import { meetingResources } from "./provider-resources";

it.each(["corrupt", "ENOENT", "EACCES", "EAGAIN"])(
	"retries only transient conversion failures: %s",
	async (failure) => {
		converter.failure = failure;
		converter.attempts = 0;
		const root = await mkdtemp(join(tmpdir(), "oq-conversion-retry-"));
		const id = "00000000-0000-4000-8000-000000000111";
		const directory = await meetingDirectory(root, id);
		try {
			await writeFile(join(directory, "final_recording.mp3"), "fake audio");
			const result = await Effect.runPromise(
				Effect.either(meetingResources(root, "fake-ffmpeg").pcm(id)),
			);
			if (failure === "EAGAIN") {
				expect(converter.attempts).toBe(2);
				if (Either.isLeft(result)) throw result.left;
				expect(
					Array.from(
						await Effect.runPromise(Stream.runCollect(result.right.frames)),
					),
				).toEqual([new Uint8Array([1, 2])]);
				await Effect.runPromise(result.right.release);
			} else {
				expect(converter.attempts).toBe(1);
				expect(Either.isLeft(result)).toBe(true);
			}
			expect(await readdir(directory)).toEqual(["final_recording.mp3"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

// The fake converter models 121 seconds of work without wall-clock waiting.
it.each(["pcm", "audio"] as const)(
	"lets the ASR deadline bound slow %s conversion",
	async (mode) => {
		converter.failure = "slow";
		converter.attempts = 0;
		const root = await mkdtemp(join(tmpdir(), "oq-conversion-slow-"));
		const id = "00000000-0000-4000-8000-000000000111";
		const directory = await meetingDirectory(root, id);
		try {
			await writeFile(join(directory, "final_recording.mp3"), "fake audio");
			const audio = await Effect.runPromise(
				meetingResources(root, "fake-ffmpeg")[mode](id),
			);
			await Effect.runPromise(audio.release);
			expect(await readdir(directory)).toEqual(["final_recording.mp3"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

it.each(["pcm", "audio"] as const)(
	"cancels real resource %s conversion and removes partial output",
	async (mode) => {
		converter.failure = "blocked";
		converter.attempts = 0;
		converter.aborted = false;
		const root = await mkdtemp(join(tmpdir(), "oq-conversion-abort-"));
		const id = "00000000-0000-4000-8000-000000000111";
		const directory = await meetingDirectory(root, id);
		try {
			await writeFile(join(directory, "final_recording.mp3"), "fake audio");
			const entered = new Promise<void>((resolve) => {
				converter.entered = resolve;
			});
			const fiber = Effect.runFork(
				meetingResources(root, "fake-ffmpeg")[mode](id),
			);
			await entered;
			await Effect.runPromise(Fiber.interrupt(fiber));
			expect(converter.aborted).toBe(true);
			expect(await readdir(directory)).toEqual(["final_recording.mp3"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);

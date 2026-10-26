import { spawn } from "node:child_process";
import { constants, openAsBlob } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema, Stream } from "effect";
import {
	MeetingResource,
	type MeetingResources,
} from "../../../../../packages/edge/src/ai/speech/meeting-resources";
import {
	isMeetingError,
	meetingError,
} from "../../../../../packages/edge/src/meetings/meeting-errors";
import {
	meetingDirectory,
	privateOutput,
	writePrivateFile,
} from "./private-files";

const readPrivate = async (path: string): Promise<string> => {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > 8_000_000)
			throw meetingError("StorageFailed");
		return await file.readFile("utf8");
	} finally {
		await file.close();
	}
};
const io = <A>(use: (signal: AbortSignal) => Promise<A>) =>
	Effect.tryPromise({
		try: use,
		catch: (cause) =>
			isMeetingError(cause) ? cause : meetingError("StorageFailed", cause),
	});
export function meetingResources(
	root: string,
	ffmpeg: string,
): MeetingResources {
	const directory = (ref: string) => io(() => meetingDirectory(root, ref));
	const convert = (ref: string, format: "mp3" | "pcm") =>
		Effect.gen(function* () {
			const dir = yield* directory(ref);
			const input = join(dir, "final_recording.mp3");
			yield* io(async () => {
				const stat = await lstat(input).catch(() => undefined);
				if (!stat?.isFile() || !stat.size) throw meetingError("AudioMissing");
			});
			const path = join(dir, `provider-${crypto.randomUUID()}.${format}`);
			const release = io(() => rm(path, { force: true })).pipe(
				Effect.catchAll((error) =>
					Effect.logWarning("Meeting temporary audio cleanup failed", error),
				),
			);
			yield* io(async (signal) => {
				await privateOutput(path);
				await new Promise<void>((resolve, reject) => {
					const child = spawn(
						ffmpeg,
						[
							"-nostdin",
							"-v",
							"error",
							"-y",
							"-i",
							input,
							"-ac",
							"1",
							"-ar",
							format === "pcm" ? "24000" : "48000",
							...(format === "pcm"
								? ["-f", "s16le", "-acodec", "pcm_s16le"]
								: ["-codec:a", "libmp3lame"]),
							path,
						],
						{ signal, stdio: "ignore" },
					);
					child.once("error", reject);
					child.once("close", (code) =>
						code === 0 ? resolve() : reject(meetingError("CaptureFailed")),
					);
				});
				const stat = await lstat(path);
				if (!stat.isFile() || !stat.size) throw meetingError("CaptureFailed");
			}).pipe(
				Effect.onError(() => release),
				Effect.retry({
					times: 1,
					while: (error) => {
						const cause = error.originalCause;
						return (
							typeof cause === "object" &&
							cause !== null &&
							"code" in cause &&
							["EAGAIN", "EBUSY", "ETXTBSY", "EMFILE", "ENFILE"].includes(
								String(cause.code),
							)
						);
					},
				}),
			);
			return { path, release };
		});
	return {
		load: (ref) =>
			Effect.gen(function* () {
				const dir = yield* directory(ref);
				return yield* io(async () => {
					try {
						return Schema.decodeUnknownSync(MeetingResource)(
							JSON.parse(await readPrivate(join(dir, "provider-state.json"))),
						);
					} catch (cause) {
						if (
							typeof cause === "object" &&
							cause !== null &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
							return undefined;
						throw cause;
					}
				});
			}),
		save: (ref, state) =>
			Effect.gen(function* () {
				const dir = yield* directory(ref);
				yield* io(() =>
					writePrivateFile(
						join(dir, "provider-state.json"),
						JSON.stringify(Schema.encodeSync(MeetingResource)(state)),
					),
				);
			}),
		audio: (ref) =>
			Effect.gen(function* () {
				const converted = yield* convert(ref, "mp3");
				return yield* io(async () => ({
					blob: await openAsBlob(converted.path, { type: "audio/mpeg" }),
					release: converted.release,
				})).pipe(Effect.onError(() => converted.release));
			}),
		pcm: (ref) =>
			Effect.gen(function* () {
				const converted = yield* convert(ref, "pcm");
				const frames = Stream.fromAsyncIterable(
					{
						async *[Symbol.asyncIterator]() {
							const file = await open(
								converted.path,
								constants.O_RDONLY | constants.O_NOFOLLOW,
							);
							try {
								while (true) {
									const bytes = Buffer.alloc(30720);
									const read = await file.read(bytes, 0, bytes.length, null);
									if (!read.bytesRead) break;
									yield new Uint8Array(bytes.subarray(0, read.bytesRead));
								}
							} finally {
								await file.close();
							}
						},
					},
					(cause) => meetingError("TranscriptionFailed", cause),
				);
				return { frames, release: converted.release };
			}),
		artifacts: (ref, raw, segments) =>
			Effect.gen(function* () {
				const dir = yield* directory(ref);
				const ordered = [...segments].sort((a, b) => a.startMs - b.startMs);
				yield* io(async () => {
					await writePrivateFile(
						join(dir, "MM_Transcription.txtoriginal.json"),
						JSON.stringify(raw),
					);
					await writePrivateFile(
						join(dir, "MM_Transcription.txt"),
						JSON.stringify(
							ordered.map((s) => ({
								speaker_id: s.speaker,
								text: s.text,
								time: s.startMs,
								endMs: s.endMs,
							})),
						),
					);
				});
			}),
	};
}

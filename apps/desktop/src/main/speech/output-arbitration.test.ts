import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Redacted,
	Stream,
} from "effect";
import { vi } from "vitest";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import { AiProtocolInvalid } from "../../../../../packages/edge/src/ai/ai-errors";
import {
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { sttProfile } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import { createDesktopDiagnostics } from "../diagnostics";
import { type AudioWorker, createDesktopAudioOutput } from "./electron-audio";

vi.mock("electron", () => ({
	app: {},
	BrowserWindow: class {},
	session: {},
	systemPreferences: {},
}));

describe("production speech output sharing", () => {
	it.effect(
		"preempts every soundboard resource and leaves TTS alive after a delayed board stop",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const playing = new Set(["key-A", "key-B"]);
				const board = yield* owner.acquire(
					"soundboard",
					Effect.sync(() => {
						playing.clear();
					}),
				);
				let closed = 0;
				const worker: AudioWorker = {
					invoke: async <A>(): Promise<A> => undefined as A,
					close: async () => {
						closed++;
					},
				};
				const output = createDesktopAudioOutput(owner, async () => worker);
				const speech = yield* output.acquire;
				expect(playing.size).toBe(0);
				yield* speech.ready;
				yield* speech.ready;
				expect(
					yield* owner.acquire("soundboard", Effect.void).pipe(Effect.either),
				).toMatchObject({
					_tag: "Left",
					left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
				});
				yield* board.release;
				expect(closed).toBe(0);
				yield* speech.stop;
				yield* speech.stop;
				expect(closed).toBe(1);
			}),
	);
	it.effect(
		"physically closes a late speech worker without touching a replacement",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const open = yield* Deferred.make<AudioWorker>();
				let oldClosed = 0,
					freshClosed = 0,
					readyCalls = 0;
				const oldWorker: AudioWorker = {
					invoke: async <A>(): Promise<A> => {
						readyCalls++;
						return undefined as A;
					},
					close: async () => {
						oldClosed++;
					},
				};
				const newWorker: AudioWorker = {
					invoke: async <A>(): Promise<A> => undefined as A,
					close: async () => {
						freshClosed++;
					},
				};
				let calls = 0;
				const output = createDesktopAudioOutput(owner, () =>
					++calls === 1
						? Effect.runPromise(Deferred.await(open))
						: Promise.resolve(newWorker),
				);
				const old = yield* output.acquire;
				const preparing = yield* old.ready.pipe(Effect.either, Effect.fork);
				yield* Effect.yieldNow();
				const next = yield* output.acquire;
				yield* next.ready;
				yield* Deferred.succeed(open, oldWorker);
				expect(yield* Fiber.join(preparing)).toMatchObject({ _tag: "Left" });
				expect(oldClosed).toBe(1);
				expect(readyCalls).toBe(0);
				yield* old.stop;
				expect(freshClosed).toBe(0);
				yield* next.stop;
				expect(freshClosed).toBe(1);
			}),
	);
	it.effect(
		"holds the actual recognition capture lease until interruption and releases without resuming soundboard",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				let stopped = 0;
				yield* owner.acquire(
					"soundboard",
					Effect.sync(() => {
						stopped++;
					}),
				);
				const opened = yield* Deferred.make<void>();
				const output = createDesktopAudioOutput(owner, () =>
					Promise.reject(new Error("capture must not open speaker")),
				);
				const layer = AiSpeechService.Default.pipe(
					Layer.provide(
						Layer.mergeAll(
							Layer.succeed(SpeechOutput, output),
							Layer.succeed(AiCredentials, {
								resolve: () => Effect.succeed(Redacted.make("synthetic")),
								revoked: () => Effect.never,
							}),
							Layer.succeed(SpeechWebSocket, {
								connect: () =>
									Deferred.succeed(opened, undefined).pipe(
										Effect.as({
											send: () => Effect.void,
											receive: Effect.never,
											close: Effect.void,
										}),
									),
							}),
						),
					),
				);
				yield* Effect.gen(function* () {
					const service = yield* AiSpeechService;
					const recognition = yield* service
						.recognize(sttProfile, Stream.never)
						.pipe(Effect.fork);
					yield* Deferred.await(opened);
					expect(stopped).toBe(1);
					expect(
						yield* owner.acquire("soundboard", Effect.void).pipe(Effect.either),
					).toMatchObject({
						_tag: "Left",
						left: { code: "QUAKE.AUDIO.OUTPUT_BUSY" },
					});
					yield* Fiber.interrupt(recognition);
					const board = yield* owner.acquire("soundboard", Effect.void);
					expect(stopped).toBe(1);
					yield* board.release;
				}).pipe(Effect.provide(layer));
			}),
	);
	it.effect(
		"releases capture after protocol failure through the actual recognition service",
		() =>
			Effect.gen(function* () {
				const owner = yield* makeAudioOutput;
				const output = createDesktopAudioOutput(owner, () =>
					Promise.reject(new Error("no speaker")),
				);
				yield* Effect.gen(function* () {
					const service = yield* AiSpeechService;
					expect(
						yield* service
							.recognize(sttProfile, Stream.empty)
							.pipe(Effect.either),
					).toMatchObject({ _tag: "Left" });
					const board = yield* owner.acquire("soundboard", Effect.void);
					yield* board.release;
				}).pipe(
					Effect.provide(
						AiSpeechService.Default.pipe(
							Layer.provide(
								Layer.mergeAll(
									Layer.succeed(SpeechOutput, output),
									Layer.succeed(AiCredentials, {
										resolve: () => Effect.succeed(Redacted.make("synthetic")),
										revoked: () => Effect.never,
									}),
									Layer.succeed(SpeechWebSocket, {
										connect: () =>
											Effect.succeed({
												send: () => Effect.void,
												receive: Effect.fail(new AiProtocolInvalid()),
												close: Effect.void,
											}),
									}),
								),
							),
						),
					),
				);
			}),
	);
	it("persists ownership failures with native cause identity and correlated spans without private audio data", async () => {
		const directory = await mkdtemp(join(tmpdir(), "oq-output-diagnostics-"));
		const diagnostics = createDesktopDiagnostics({ directory });
		const runtime = ManagedRuntime.make(diagnostics.layer);
		try {
			await runtime.runPromise(
				diagnostics
					.instrument(
						Effect.gen(function* () {
							const owner = yield* makeAudioOutput;
							const cause = Object.assign(
								new Error("/private/music.mp3 Bearer secret"),
								{ code: "EACCES" },
							);
							yield* owner.acquire("soundboard", Effect.die(cause));
							yield* owner.acquire("speech", Effect.void);
						}),
						"app.background",
					)
					.pipe(Effect.either),
			);
		} finally {
			await runtime.dispose();
			await diagnostics.close();
		}
		try {
			const raw = (
				await Promise.all(
					(
						await readdir(directory)
					)
						.filter((file) => file.endsWith(".ndjson"))
						.map((file) => readFile(join(directory, file), "utf8")),
				)
			).join("\n");
			expect(raw).toContain("AudioOutput.acquire");
			expect(raw).toContain("AudioOutput.stop");
			expect(raw).toContain("QUAKE.AUDIO.OUTPUT_FAILED");
			expect(raw).toContain("EACCES");
			expect(raw).not.toMatch(/private\/music|Bearer|secret/);
			const rows = raw
				.trim()
				.split("\n")
				.map(
					(line) =>
						JSON.parse(line) as { span_name?: string; trace_id?: string },
				);
			const parent = rows.find((row) => row.span_name === "app.background");
			expect(
				rows.find((row) => row.span_name === "AudioOutput.acquire")?.trace_id,
			).toBe(parent?.trace_id);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});

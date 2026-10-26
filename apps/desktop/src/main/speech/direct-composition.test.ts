import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Deferred,
	Effect,
	Layer,
	Redacted,
	TestClock,
	TestContext,
} from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { wav } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import { GridVoiceRuntime } from "../../../../../packages/edge/src/voice/surface";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { createDirectChat } from "../chat/host";
import { createDirectChatVoice } from "../chat/voice";
import { createDesktopDiagnostics } from "../diagnostics";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import { voiceSurfaceLayer } from "../voice";
import { createSpeechVoiceBinding } from "./composition";
import { emptySpeechSettings } from "./settings";

vi.mock("electron", () => ({
	app: {},
	BrowserWindow: {},
	session: {},
	systemPreferences: {},
	ipcMain: {},
	shell: {},
	clipboard: {},
	dialog: {},
}));

const request = {
	serial: "synthetic-quake",
	keyCode: "1,5",
	agentId: "main",
	message: "Private direct prompt",
};

async function fixture(synthesisFails = false) {
	const directory = await mkdtemp(join(tmpdir(), "oq-direct-speech-"));
	const diagnostics = createDesktopDiagnostics({
		directory: join(directory, "diagnostics"),
	});
	const background = makeDesktopRuntime(TestContext.TestContext, diagnostics);
	const events: VoiceSurfaceEvent[] = [];
	const reported: string[] = [];
	const speechRequests: { input: string }[] = [];
	const playbacks: {
		drain: Deferred.Deferred<void>;
		active: boolean;
		stops: number;
	}[] = [];
	const inferenceRequests: unknown[] = [];
	let inferenceAborted = false;
	let input: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			input = controller;
		},
	});
	const direct = createDirectChat({
		directory: join(directory, "chat"),
		diagnostics,
		credentials: {
			resolve: () => Effect.succeed(Redacted.make("private-model-key")),
			revoked: () => Effect.never,
		},
		models: () =>
			Effect.succeed([
				{
					id: "model",
					role: "default",
					provider: "generic",
					model: "synthetic",
					baseUrl: "http://localhost:8642/v1",
					credentialRef: "00000000-0000-4000-8000-000000000001",
					maxTokens: 1024,
				},
			]),
		fetch: async (_url, init) => {
			inferenceRequests.push(JSON.parse(String(init?.body)));
			init?.signal?.addEventListener(
				"abort",
				() => {
					inferenceAborted = true;
				},
				{ once: true },
			);
			return new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	const fallback = vi.fn(() => Effect.void);
	const keys = new Map<string, string>();
	let stored: unknown = emptySpeechSettings;
	const binding = createSpeechVoiceBinding({
		direct: (original) => createDirectChatVoice(direct, original),
		run: (effect) => background.runPromise(effect),
		speech: {
			diagnostics,
			speechError: (code) =>
				Effect.sync(() => {
					reported.push(code);
				}),
			storage: {
				read: async () => stored,
				write: async (value) => {
					stored = value;
				},
			},
			credentials: {
				put: async (value) => {
					const id = crypto.randomUUID();
					keys.set(id, value);
					return id;
				},
				get: async (id) => keys.get(id) ?? "",
				remove: async (id) => {
					keys.delete(id);
				},
			},
			ports: Layer.mergeAll(
				Layer.succeed(SpeechWebSocket, {
					connect: () => Effect.die("unexpected recognition connection"),
				}),
				Layer.succeed(SpeechHttp, {
					fetch: async (_url, init) => {
						speechRequests.push({
							...(JSON.parse(String(init.body)) as { input: string }),
						});
						if (synthesisFails)
							throw Object.assign(new Error("private provider failure"), {
								code: "EACCES",
							});
						return new Response(wav(), {
							headers: { "Content-Type": "audio/wav" },
						});
					},
				}),
				Layer.succeed(SpeechOutput, {
					suspendForCapture: Effect.void,
					acquire: Effect.gen(function* () {
						const item = {
							drain: yield* Deferred.make<void>(),
							active: false,
							stops: 0,
						};
						return {
							ready: Effect.void,
							stop: Effect.sync(() => {
								item.stops++;
							}),
							play: () =>
								Effect.sync(() => {
									item.active = true;
									playbacks.push(item);
								}).pipe(
									Effect.zipRight(Deferred.await(item.drain)),
									Effect.ensuring(
										Effect.sync(() => {
											item.active = false;
										}),
									),
								),
						};
					}),
				}),
			),
		},
	});
	const voice = makeDesktopRuntime(
		voiceSurfaceLayer(
			{
				mock: true,
				tones: { play: () => {} },
				runtime: () =>
					binding.decorate(
						Layer.succeed(GridVoiceRuntime, {
							select: () => Effect.void,
							startCapture: () => Effect.die("unexpected physical capture"),
							releaseCapture: () => Effect.void,
							cancelCapture: () => Effect.void,
							cancelFlow: () => Effect.void,
							sendText: fallback,
						}),
					),
			},
			(event) => {
				events.push(event);
				binding.onEvent(event);
			},
		),
		diagnostics,
	);
	const runtime = await voice.runPromise(GridVoiceRuntime);
	await background.runPromise(
		binding.settings.request({
			_tag: "Save",
			settings: {
				version: 1,
				speakAnswers: true,
				tts: { provider: "openai", voice: "marin", language: "en" },
			},
			ttsKey: "private-TTS-key",
		}),
	);
	// The real binding deliberately dispatches observations without blocking the UI.
	// Await externally visible receipts below rather than treating publication as playback.
	const write = (content: string | null) =>
		input.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: content === null ? "stop" : null }] })}\n\n`,
			),
		);
	const answer = () =>
		events
			.filter(
				(event) => event._tag === "Chunk" && event.chunk.type === "answer",
			)
			.map((event) =>
				event._tag === "Chunk" && event.chunk.type === "answer"
					? event.chunk.textDelta
					: "",
			)
			.join("");
	return {
		directory,
		advance: (millis: number) =>
			background.runPromise(TestClock.adjust(millis)),
		closeVoice: () => voice.dispose(),
		events,
		reported,
		logs: async () => {
			await diagnostics.flush();
			return readFile(
				join(directory, "diagnostics", "diagnostics.0.ndjson"),
				"utf8",
			);
		},
		speechRequests,
		playbacks,
		inferenceRequests,
		fallback,
		answer,
		aborted: () => inferenceAborted,
		history: async () => {
			const started = events.find((event) => event._tag === "TurnStarted");
			if (started?._tag !== "TurnStarted") throw new Error("missing turn");
			return direct.runtime.runPromise(direct.history(started.sessionId));
		},
		send: async () => {
			await voice.runPromise(runtime.sendText(request));
			await vi.waitFor(() => expect(inferenceRequests).toHaveLength(1));
		},
		delta: (text: string) => write(text),
		finish: () => {
			write(null);
			input.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
			input.close();
		},
		cancel: () =>
			voice.runPromise(runtime.cancelFlow(request.serial, request.keyCode)),
		drain: (index: number) => {
			const item = playbacks[index];
			if (!item) throw new Error("missing playback");
			return background.runPromise(Deferred.succeed(item.drain, undefined));
		},
		ended: () =>
			events.some(
				(event) => event._tag === "Chunk" && event.chunk.type === "end",
			),
		async close() {
			await voice.dispose();
			await direct.dispose();
			await background.dispose();
			await diagnostics.close();
			await rm(directory, { recursive: true, force: true });
		},
	};
}

describe("production direct chat to ordered speech", () => {
	it.each(["inference", "playback"] as const)(
		"disposes voice during %s and cancels its host turn before returning",
		async (phase) => {
			const f = await fixture();
			try {
				await f.send();
				if (phase === "playback") {
					f.delta("Speaking while inference stays open.");
					await vi.waitFor(() => expect(f.playbacks).toHaveLength(1));
				}
				await f.closeVoice();
				expect(f.aborted()).toBe(true);
				expect(
					f.playbacks.every(
						(playback) => !playback.active && playback.stops === 1,
					),
				).toBe(true);
				const history = await f.history();
				expect(history.turns).toHaveLength(1);
				expect(history.turns[0]?.status).toBe("cancelled");
			} finally {
				await f.close();
			}
		},
		3000,
	);

	it("serializes punctuation and 200-character segments through ChatService, then drains audio after inference completes", async () => {
		const f = await fixture();
		try {
			await f.send();

			f.delta("First sentence.");
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(1));

			f.delta("x".repeat(200));
			f.delta("final tail");
			f.finish();
			await vi.waitFor(() => expect(f.ended()).toBe(true));
			expect(f.speechRequests.map((r) => r.input)).toEqual(["First sentence."]);
			expect(f.playbacks[0]?.active).toBe(true);
			await f.drain(0);
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(2));
			expect(f.speechRequests.map((r) => r.input)).toEqual([
				"First sentence.",
				"x".repeat(200),
			]);
			await f.drain(1);
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(3));
			expect(f.speechRequests.map((r) => r.input)).toEqual([
				"First sentence.",
				"x".repeat(200),
				"final tail",
			]);
			await f.drain(2);
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(4));
			expect(f.speechRequests.at(-1)?.input).toBe("Finished");
			await f.drain(3);
			await vi.waitFor(() =>
				expect(f.playbacks.every((p) => !p.active && p.stops === 1)).toBe(true),
			);
			expect(f.answer()).toBe(`First sentence.${"x".repeat(200)}final tail`);
			expect(f.fallback).not.toHaveBeenCalled();
		} finally {
			await f.close();
		}
	}, 10000);
	it("flushes unpunctuated text while the real inference stream remains open", async () => {
		const f = await fixture();
		try {
			await f.send();
			f.delta("pending fragment");
			await vi.waitFor(() => expect(f.answer()).toBe("pending fragment"));
			expect(f.speechRequests).toHaveLength(0);
			await f.advance(1999);
			expect(f.playbacks).toHaveLength(0);
			await f.advance(1);
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(1));
			expect(f.ended()).toBe(false);
			expect(f.speechRequests.map((r) => r.input)).toEqual([
				"pending fragment",
			]);
			await f.cancel();
			expect(f.playbacks[0]?.active).toBe(false);
		} finally {
			await f.close();
		}
	}, 10000);
	it("cancels active playback and queued segments without erasing direct chat history", async () => {
		const f = await fixture();
		try {
			await f.send();
			f.delta("Playing now. Never say this.");
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(1));
			await f.cancel();
			await vi.waitFor(() => expect(f.playbacks[0]?.active).toBe(false));
			expect(f.aborted()).toBe(true);
			expect(f.speechRequests.map((r) => r.input)).toEqual(["Playing now."]);
			expect(f.answer()).toBe("Playing now. Never say this.");
			const history = await f.history();
			expect(history.turns[0]?.snapshot.text).toBe(
				"Playing now. Never say this.",
			);
			expect(history.turns[0]?.status).toBe("cancelled");
			expect(() => f.delta("late provider text")).toThrow(TypeError);
			expect(
				f.events.filter(
					(event) => event._tag === "Chunk" && event.chunk.type === "end",
				),
			).toHaveLength(1);
		} finally {
			await f.close();
		}
	}, 10000);
	it("keeps all chat text when the unsaid queue exceeds 4000 characters", async () => {
		const f = await fixture();
		try {
			await f.send();
			f.delta("a".repeat(4000));
			await vi.waitFor(() => expect(f.playbacks).toHaveLength(1));
			f.delta("overflow still readable");
			f.finish();
			await vi.waitFor(() => expect(f.ended()).toBe(true));
			await vi.waitFor(() => expect(f.playbacks[0]?.active).toBe(false));
			expect(f.answer()).toBe(`${"a".repeat(4000)}overflow still readable`);
			expect(f.speechRequests).toHaveLength(1);
			await vi.waitFor(() =>
				expect(f.reported).toEqual(["VOICE.TTS.QUEUE_FULL"]),
			);
		} finally {
			await f.close();
		}
	}, 10000);
	it("reports synthesis failure while direct inference and readable text complete", async () => {
		const f = await fixture(true);
		try {
			await f.send();
			f.delta("Readable answer.");
			await vi.waitFor(() => expect(f.speechRequests).toHaveLength(1));
			f.delta(" It still continues.");
			f.finish();
			await vi.waitFor(() => expect(f.ended()).toBe(true));
			await vi.waitFor(() => expect(f.reported).toHaveLength(1));
			expect(f.answer()).toBe("Readable answer. It still continues.");
			expect(f.playbacks).toHaveLength(0);
			expect(f.speechRequests.map((r) => r.input)).toEqual([
				"Readable answer.",
				" It still continues.",
				"Finished",
			]);
			const logs = await f.logs();
			expect(logs).toContain('"span_name":"speech.playback"');
			expect(logs).toContain('"outcome":"failure"');
			for (const privateText of [
				"Private direct prompt",
				"Readable answer.",
				"private-TTS-key",
				"private-model-key",
				"private provider failure",
			])
				expect(logs).not.toContain(privateText);
			await f.cancel();
		} finally {
			await f.close();
		}
	}, 10000);
});

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Option, Queue } from "effect";
import { vi } from "vitest";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { object } from "../../../../../packages/edge/src/ai/speech/speech-session";
import {
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import type { CaptureRequest } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports";
import type { SpeechSettings } from "../../shared/speech";
import type { CaptureDriver, CaptureSession } from "./capture";
import { createDesktopSpeech } from "./factory";

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
const surface = VoiceSurface.Default.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(VoiceSurfacePublisher, { publish: () => Effect.void }),
			Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
		),
	),
);
const fixture = Effect.fn("SpeechLifecycle.fixture")(function* () {
	let saved: unknown;
	let transcripts = 0;
	const keys = new Map<string, string>();
	const opened = yield* Queue.unbounded<string>();
	const captureClosing = yield* Deferred.make<void>();
	const captureRelease = yield* Deferred.make<void>();
	const played = yield* Deferred.make<void>();
	const outputClosing = yield* Deferred.make<void>();
	const outputRelease = yield* Deferred.make<void>();
	const sockets: { messages: Queue.Queue<unknown>; closed: boolean }[] = [];
	const capture: CaptureDriver = {
		permission: Effect.succeed(true),
		open: (captureId) =>
			Effect.gen(function* () {
				let pulled = false;
				yield* Queue.offer(opened, captureId);
				return {
					pull: Effect.suspend<
						Effect.Effect.Success<CaptureSession["pull"]>,
						never,
						never
					>(() => {
						if (pulled) return Effect.never;
						pulled = true;
						return Effect.succeed({
							frames: [
								{
									captureId,
									seq: 0,
									bytes: new Uint8Array(960),
									rms: 0.1,
									peak: 0.1,
								},
							],
							done: false,
						});
					}),
					stop: Effect.void,
					close: Deferred.succeed(captureClosing, undefined).pipe(
						Effect.zipRight(Deferred.await(captureRelease)),
					),
				};
			}),
	};
	const controller = yield* createDesktopSpeech({
		storage: {
			read: async () => saved,
			write: async (value) => {
				saved = value;
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
		capture,
		sendText: () => Effect.void,
		sendTranscript: () =>
			Effect.sync(() => {
				transcripts++;
			}),
		ports: Layer.mergeAll(
			Layer.succeed(SpeechHttp, {
				fetch: async () => {
					throw new Error("No HTTP provider calls allowed");
				},
			}),
			Layer.succeed(SpeechWebSocket, {
				connect: () =>
					Effect.gen(function* () {
						const messages = yield* Queue.unbounded<unknown>();
						const socket = { messages, closed: false };
						sockets.push(socket);
						return {
							receive: Queue.take(messages),
							close: Effect.sync(() => {
								socket.closed = true;
							}),
							send: (raw) =>
								Effect.gen(function* () {
									if (typeof raw !== "string") return;
									const event = object(JSON.parse(raw));
									if (event.type === "session.update")
										yield* Queue.offer(messages, { type: "session.updated" });
									if (event.type === "input_text_buffer.commit")
										yield* Queue.offerAll(messages, [
											{ type: "response.created", response: { id: "r1" } },
											{
												type: "response.audio.delta",
												response_id: "r1",
												delta: "AAABAA==",
											},
											{
												type: "response.done",
												response: { id: "r1", status: "completed" },
											},
										]);
								}),
						};
					}),
			}),
			Layer.succeed(SpeechOutput, {
				suspendForCapture: Effect.void,
				acquire: Effect.succeed({
					ready: Effect.void,
					play: () =>
						Deferred.succeed(played, undefined).pipe(
							Effect.zipRight(Effect.never),
						),
					stop: Deferred.succeed(outputClosing, undefined).pipe(
						Effect.zipRight(Deferred.await(outputRelease)),
					),
				}),
			}),
		),
	});
	return {
		controller,
		sockets,
		opened,
		captureClosing,
		captureRelease,
		played,
		outputClosing,
		outputRelease,
		transcripts: () => transcripts,
	};
});
const settings: SpeechSettings = {
	version: 1,
	speakAnswers: false,
	stt: { provider: "openai", language: "en" },
	tts: {
		provider: "qwen-realtime",
		language: "en",
		voice: "Cherry",
		realtimeEnabled: true,
	},
};
const request: CaptureRequest = {
	serial: "fake-quake",
	keyCode: "1,5",
	captureId: "first",
	generation: 1,
	type: "aiChat",
	agentId: Option.none(),
};
describe("production factory profile replacement", () => {
	it.scoped(
		"awaits active capture cleanup, acquires fresh engines and drops stale results across repeated replacement",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				yield* f.controller.settings.request({
					_tag: "Save",
					settings,
					sttKey: "stt-only",
					ttsKey: "tts-only",
				});
				yield* f.controller.runtime.startCapture(request);
				expect(yield* Queue.take(f.opened)).toBe("first");
				const replacing = yield* f.controller.settings
					.request({
						_tag: "Save",
						settings: {
							...settings,
							stt: { provider: "xfy", language: "en_us" },
						},
						sttXfy: {
							appId: "fake-app",
							apiKey: "fake-key",
							apiSecret: "fake-secret",
						},
					})
					.pipe(Effect.fork);
				yield* Deferred.await(f.captureClosing);
				expect((yield* Fiber.poll(replacing))._tag).toBe("None");
				yield* Deferred.succeed(f.captureRelease, undefined);
				const next = yield* Fiber.join(replacing);
				expect(f.sockets[0]?.closed).toBe(true);
				yield* f.controller.runtime.startCapture({
					...request,
					captureId: "second",
					generation: 2,
				});
				expect(yield* Queue.take(f.opened)).toBe("second");
				const old = f.sockets[0];
				if (!old) return yield* Effect.die("Missing old socket");
				yield* Queue.offerAll(old.messages, [
					{ type: "input_audio_buffer.committed", item_id: "stale" },
					{
						type: "conversation.item.input_audio_transcription.completed",
						item_id: "stale",
						transcript: "stale private result",
					},
				]);
				yield* f.controller.settings.request({
					_tag: "Save",
					settings,
					sttKey: "replacement",
				});
				expect(f.sockets).toHaveLength(2);
				expect(f.sockets.every((s) => s.closed)).toBe(true);
				expect(f.transcripts()).toBe(0);
				expect(next.settings.stt?.provider).toBe("xfy");
				expect(
					(yield* f.controller.settings.request({ _tag: "Get" })).settings,
				).toEqual(settings);
			}).pipe(Effect.provide(surface)),
	);
	it.scoped(
		"awaits owned output stop before publishing another synthesis profile",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture();
				yield* f.controller.settings.request({
					_tag: "Save",
					settings,
					sttKey: "stt-only",
					ttsKey: "tts-only",
				});
				const reading = yield* f.controller
					.readAloud("synthetic text")
					.pipe(Effect.fork);
				yield* Deferred.await(f.played);
				const replacing = yield* f.controller.settings
					.request({
						_tag: "Save",
						settings: {
							...settings,
							tts: {
								provider: "azure",
								language: "en-US",
								voice: "en-US-JennyNeural",
							},
						},
						ttsKey: "azure-only",
					})
					.pipe(Effect.fork);
				yield* Deferred.await(f.outputClosing);
				expect((yield* Fiber.poll(replacing))._tag).toBe("None");
				yield* Deferred.succeed(f.outputRelease, undefined);
				expect((yield* Fiber.join(replacing)).settings.tts?.provider).toBe(
					"azure",
				);
				expect(yield* Fiber.join(reading)).toEqual({ _tag: "cancelled" });
				expect(f.sockets.every((s) => s.closed)).toBe(true);
			}).pipe(Effect.provide(surface)),
	);
});

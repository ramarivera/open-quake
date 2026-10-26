import { Effect, Fiber, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import type { SpeechOutcome } from "../../../../../packages/edge/src/ai/speech/speech-service";
import { wav } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service";
import {
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface";
import type { SpeechSettings } from "../../shared/speech";
import type { AudioWorker } from "./electron-audio";
import {
	createDesktopAudioOutput,
	createElectronCaptureDriver,
} from "./electron-audio";
import { createDesktopSpeech } from "./factory";
import { emptySpeechSettings } from "./settings";

vi.mock("electron", () => ({
	app: {},
	BrowserWindow: class {},
	session: {},
	systemPreferences: {},
}));
const surface = VoiceSurface.Default.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.succeed(VoiceSurfacePublisher, { publish: () => Effect.void }),
			Layer.succeed(VoiceTonePort, { play: () => Effect.void }),
		),
	),
);

describe("turnkey production factory with synthetic ports", () => {
	it("joins the actual native-vault adapter, explicit settings, HTTP speech service and owned natural-drain output", async () => {
		let drain: (() => void) | undefined;
		const drained = new Promise<void>((resolve) => {
			drain = resolve;
		});
		let entered: (() => void) | undefined;
		const playing = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const keys = new Map<string, string>();
		let stored: unknown = emptySpeechSettings;
		let closed = 0;
		const methods: string[] = [];
		const requests: { url: string; authorization: string | null }[] = [];
		const worker: AudioWorker = {
			invoke: async <A>(method: string): Promise<A> => {
				methods.push(method);
				if (method === "play") {
					entered?.();
					await drained;
				}
				return undefined as A;
			},
			close: async () => {
				closed++;
			},
		};
		const output = createDesktopAudioOutput(
			await Effect.runPromise(makeAudioOutput),
			async () => worker,
		);
		const layer = Layer.mergeAll(
			Layer.succeed(SpeechOutput, output),
			Layer.succeed(SpeechWebSocket, {
				connect: () => Effect.die("No STT selected"),
			}),
			Layer.succeed(SpeechHttp, {
				fetch: async (url, init) => {
					requests.push({
						url,
						authorization: new Headers(init.headers).get("Authorization"),
					});
					return new Response(wav(), {
						headers: { "Content-Type": "audio/wav" },
					});
				},
			}),
		);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const controller = yield* createDesktopSpeech({
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
							get: async (ref) => keys.get(ref) ?? "",
							remove: async (ref) => {
								keys.delete(ref);
							},
						},
						ports: layer,
						capture: {
							permission: Effect.die("no microphone"),
							open: () => Effect.die("no microphone"),
						},
						sendText: () => Effect.void,
						sendTranscript: () => Effect.die("no transcript"),
					});
					expect(
						yield* controller.readAloud("Before configuring"),
					).toMatchObject({ _tag: "textOnly" });
					const settings: SpeechSettings = {
						version: 1,
						speakAnswers: false,
						tts: { provider: "openai", voice: "marin", language: "en" },
					};
					yield* controller.settings.request({
						_tag: "Save",
						settings,
						ttsKey: "synthetic-only",
					});
					const reader = yield* controller
						.readAloud("After configuring")
						.pipe(Effect.fork);
					yield* Effect.promise(() => playing);
					expect(Option.isNone(yield* Fiber.poll(reader))).toBe(true);
					expect(requests).toEqual([
						{
							url: "https://api.openai.com/v1/audio/speech",
							authorization: "Bearer synthetic-only",
						},
					]);
					expect(methods).toEqual(["ready", "play"]);
					drain?.();
					expect(yield* Fiber.join(reader)).toEqual({ _tag: "completed" });
					expect(closed).toBe(1);
					expect(JSON.stringify(stored)).not.toContain("synthetic-only");
				}),
			).pipe(Effect.provide(surface)),
		);
	});
	it("physically closes a late worker after recorder cancellation before invoking capture", async () => {
		let grant: ((worker: AudioWorker) => void) | undefined;
		const granted = new Promise<AudioWorker>((resolve) => {
			grant = resolve;
		});
		const invoke = vi.fn(async () => undefined) as AudioWorker["invoke"];
		const close = vi.fn(async () => undefined);
		const driver = createElectronCaptureDriver(async () => granted);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fiber = yield* driver.open("late").pipe(Effect.fork);
					yield* Effect.yieldNow();
					const stopping = yield* Fiber.interrupt(fiber).pipe(Effect.fork);
					yield* Effect.yieldNow();
					expect(Option.isNone(yield* Fiber.poll(stopping))).toBe(true);
					grant?.({ invoke, close });
					yield* Fiber.join(stopping);
					expect(invoke).not.toHaveBeenCalled();
					expect(close).toHaveBeenCalledOnce();
				}),
			),
		);
	});
});

it("AI-103 AI-010: ignores blank read-aloud and refreshes saved voice/key on the next request", async () => {
	const keys = new Map<string, string>();
	let stored: unknown = emptySpeechSettings;
	const requests: { authorization: string | null; body: unknown }[] = [];
	let outputs = 0;
	let playing: (() => void) | undefined;
	const played = new Promise<void>((resolve) => {
		playing = resolve;
	});
	const ports = Layer.mergeAll(
		Layer.succeed(SpeechHttp, {
			fetch: async (_url, init) => {
				requests.push({
					authorization: new Headers(init.headers).get("Authorization"),
					body: JSON.parse(String(init.body)),
				});
				return new Response(wav(), {
					headers: { "Content-Type": "audio/wav" },
				});
			},
		}),
		Layer.succeed(SpeechWebSocket, {
			connect: () => Effect.die("no microphone"),
		}),
		Layer.succeed(SpeechOutput, {
			suspendForCapture: Effect.void,
			acquire: Effect.sync(() => {
				outputs++;
				return {
					ready: Effect.void,
					play: () =>
						Effect.suspend(() => {
							playing?.();
							return outputs === 1 ? Effect.never : Effect.void;
						}),
					stop: Effect.void,
				};
			}),
		}),
	);
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const controller = yield* createDesktopSpeech({
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
					ports,
					capture: {
						permission: Effect.die("no microphone"),
						open: () => Effect.die("no microphone"),
					},
					sendText: () => Effect.void,
					sendTranscript: () => Effect.die("no microphone"),
				});
				let active: Fiber.RuntimeFiber<SpeechOutcome> | undefined;
				for (const [voice, key] of [
					["marin", "old-synthetic-key"],
					["cedar", "new-synthetic-key"],
				] as const) {
					yield* controller.settings.request({
						_tag: "Save",
						settings: {
							version: 1,
							speakAnswers: false,
							tts: { provider: "openai", voice, language: "en" },
						},
						ttsKey: key,
					});
					if (active)
						expect(yield* Fiber.join(active)).toEqual({ _tag: "cancelled" });
					for (const blank of ["", " ", "\n \t"]) {
						expect(yield* controller.readAloud(blank)).toMatchObject({
							_tag: "textOnly",
						});
					}
					expect(requests).toHaveLength(outputs);
					if (voice === "marin") {
						active = yield* controller
							.readAloud("whole utterance")
							.pipe(Effect.fork);
						yield* Effect.promise(() => played);
						expect(Option.isNone(yield* Fiber.poll(active))).toBe(true);
					} else {
						expect(yield* controller.readAloud("whole utterance")).toEqual({
							_tag: "completed",
						});
					}
					expect(requests.at(-1)).toMatchObject({
						authorization: `Bearer ${key}`,
						body: { voice, input: "whole utterance", model: "gpt-4o-mini-tts" },
					});
				}
				expect(requests).toHaveLength(2);
				expect(outputs).toBe(2);
			}),
		).pipe(Effect.provide(surface)),
	);
});

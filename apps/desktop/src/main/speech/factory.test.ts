import { Effect, Fiber, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	SpeechHttp,
	SpeechOutput,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { wav } from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
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
		const output = createDesktopAudioOutput(async () => worker);
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
					yield* Fiber.interrupt(fiber);
					grant?.({ invoke, close });
					yield* Effect.promise(async () => {
						await granted;
						await Promise.resolve();
					});
					expect(invoke).not.toHaveBeenCalled();
					expect(close).toHaveBeenCalledOnce();
				}),
			),
		);
	});
});

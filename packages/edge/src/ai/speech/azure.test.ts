import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Redacted, Stream, TestClock } from "effect";
import { beforeEach, vi } from "vitest";
import { AiCredentials } from "../ai-credentials.js";
import { AiSpeechService } from "./speech-service.js";
import { sttProfile, ttsProfile } from "./speech-test-fixtures.js";

const state = vi.hoisted(() => ({
	configs: [] as {
		key: string;
		region: string;
		speechRecognitionLanguage?: string;
		speechSynthesisLanguage?: string;
		speechSynthesisVoiceName?: string;
		speechSynthesisOutputFormat?: number;
	}[],
	writes: [] as Uint8Array[],
	closed: [] as string[],
	events: [] as string[],
	recognize: undefined as
		| ((r: { reason: number; text: string }) => void)
		| undefined,
	synthesis: undefined as ((r: { reason: number }) => void) | undefined,
	output: undefined as ((b: ArrayBuffer) => void) | undefined,
	fail: undefined as ((e: string) => void) | undefined,
	throws: false,
}));
vi.mock("microsoft-cognitiveservices-speech-sdk", () => ({
	ResultReason: {
		RecognizedSpeech: 1,
		NoMatch: 2,
		SynthesizingAudioCompleted: 3,
	},
	SpeechSynthesisOutputFormat: { Raw24Khz16BitMonoPcm: 42 },
	SpeechConfig: {
		fromSubscription: (key: string, region: string) => {
			const config = {
				key,
				region,
				close: () => {
					state.closed.push("config");
				},
			};
			state.configs.push(config);
			return config;
		},
	},
	AudioStreamFormat: {
		getWaveFormatPCM: (rate: number, bits: number, channels: number) => {
			expect([rate, bits, channels]).toEqual([24000, 16, 1]);
			return {};
		},
	},
	AudioInputStream: {
		createPushStream: () => ({
			write: (b: ArrayBuffer) => {
				state.events.push("write");
				state.writes.push(new Uint8Array(b));
			},
			close: () => {
				state.closed.push("input");
			},
		}),
	},
	PushAudioOutputStream: {
		create: (callback: { write: (b: ArrayBuffer) => void }) => {
			state.output = callback.write;
			return {
				close: () => {
					state.closed.push("output");
				},
			};
		},
	},
	AudioConfig: {
		fromStreamInput: () => ({
			close: () => {
				state.closed.push("audio");
			},
		}),
		fromStreamOutput: () => ({
			close: () => {
				state.closed.push("audio");
			},
		}),
	},
	SpeechRecognizer: class {
		constructor() {
			if (state.throws) throw new Error("fixture SDK initialization");
		}
		recognizeOnceAsync(done: typeof state.recognize, fail: typeof state.fail) {
			state.events.push("ready");
			state.recognize = done;
			state.fail = fail;
		}
		close() {
			state.closed.push("recognizer");
		}
	},
	SpeechSynthesizer: class {
		speakTextAsync(
			_text: string,
			done: typeof state.synthesis,
			fail: typeof state.fail,
		) {
			state.events.push("synthesize");
			state.synthesis = done;
			state.fail = fail;
		}
		close() {
			state.closed.push("synthesizer");
		}
	},
}));
const stt = {
	...sttProfile,
	provider: "azure" as const,
	baseUrl: "azure:speech",
	model: "azure-recognize-once",
	region: "eastasia",
	language: "en-US",
};
const tts = {
	...ttsProfile,
	provider: "azure" as const,
	baseUrl: "azure:speech",
	model: "azure-neural",
	region: "westus",
	language: "zh-CN",
	voice: "zh-CN-XiaoxiaoNeural",
	format: "pcm" as const,
};
const layer = AiSpeechService.Default.pipe(
	Layer.provide(
		Layer.succeed(AiCredentials, {
			resolve: () => Effect.succeed(Redacted.make("azure-only-key")),
			revoked: () => Effect.never,
		}),
	),
);
const tick = Effect.yieldNow().pipe(Effect.repeatN(20));
beforeEach(() => {
	state.configs = [];
	state.writes = [];
	state.closed = [];
	state.events = [];
	state.recognize = undefined;
	state.synthesis = undefined;
	state.fail = undefined;
	state.output = undefined;
	state.throws = false;
});
describe("Azure facade with fake SDK and no devices", () => {
	it.effect(
		"pushes explicit 24kHz PCM after recognition readiness, recognizes once and closes every resource",
		() =>
			Effect.gen(function* () {
				const fiber = yield* AiSpeechService.recognize(
					stt,
					Stream.make(new Uint8Array(960)),
				).pipe(Effect.provide(layer), Effect.fork);
				yield* tick;
				expect(state.events).toEqual(["ready", "write"]);
				expect(state.writes[0]).toHaveLength(960);
				expect(state.configs[0]).toMatchObject({
					key: "azure-only-key",
					region: "eastasia",
					speechRecognitionLanguage: "en-US",
				});
				state.recognize?.({ reason: 1, text: "hello" });
				expect(yield* Fiber.join(fiber)).toBe("hello");
				expect(state.closed).toEqual(
					expect.arrayContaining(["input", "recognizer", "audio", "config"]),
				);
			}),
	);
	it.effect(
		"produces explicit raw PCM via push output and selected voice without a default speaker",
		() =>
			Effect.gen(function* () {
				const fiber = yield* AiSpeechService.synthesize(tts, "hello").pipe(
					Effect.provide(layer),
					Effect.fork,
				);
				yield* tick;
				expect(state.configs[0]).toMatchObject({
					region: "westus",
					speechSynthesisLanguage: "zh-CN",
					speechSynthesisVoiceName: "zh-CN-XiaoxiaoNeural",
					speechSynthesisOutputFormat: 42,
				});
				state.output?.(new Uint8Array(960).buffer);
				state.synthesis?.({ reason: 3 });
				const audio = yield* Fiber.join(fiber);
				expect(audio.bytes).toHaveLength(960);
				expect(audio.durationMs).toBe(20);
				expect(state.closed).toEqual(
					expect.arrayContaining(["output", "audio", "config", "synthesizer"]),
				);
			}),
	);
	for (const mode of ["stt", "tts"] as const)
		it.effect(
			`${mode} cancellation physically closes the SDK instance and ignores a late callback`,
			() =>
				Effect.gen(function* () {
					const fiber = yield* (
						mode === "stt"
							? AiSpeechService.recognize(stt, Stream.never).pipe(Effect.asVoid)
							: AiSpeechService.synthesize(tts, "hello").pipe(Effect.asVoid)
					).pipe(Effect.provide(layer), Effect.fork);
					yield* tick;
					const old = state.recognize;
					yield* Fiber.interrupt(fiber);
					old?.({ reason: 1, text: "late private" });
					state.synthesis?.({ reason: 3 });
					expect(state.closed).toContain(
						mode === "stt" ? "recognizer" : "synthesizer",
					);
					expect(state.closed).toContain("config");
				}),
		);
	it.effect(
		"initialization failure preserves typed error and cleans partial acquisitions",
		() =>
			Effect.gen(function* () {
				state.throws = true;
				const result = yield* AiSpeechService.recognize(stt, Stream.empty).pipe(
					Effect.provide(layer),
					Effect.either,
				);
				expect(result).toMatchObject({
					_tag: "Left",
					left: { _tag: "AiProtocolInvalid" },
				});
				expect(state.closed).toEqual(
					expect.arrayContaining(["input", "audio", "config"]),
				);
			}),
	);
	it.effect(
		"provider error stays private and a newer instance is isolated",
		() =>
			Effect.gen(function* () {
				const first = yield* AiSpeechService.recognize(
					stt,
					Stream.make(new Uint8Array(960)),
				).pipe(Effect.provide(layer), Effect.either, Effect.fork);
				yield* tick;
				const stale = state.recognize;
				state.fail?.("private provider text azure-only-key");
				const failed = yield* Fiber.join(first);
				expect(failed).toMatchObject({
					_tag: "Left",
					left: { _tag: "AiProtocolInvalid" },
				});
				expect(JSON.stringify(failed)).not.toContain("azure-only-key");
				const second = yield* AiSpeechService.recognize(
					{ ...stt, language: "zh-TW" },
					Stream.make(new Uint8Array(960)),
				).pipe(Effect.provide(layer), Effect.fork);
				yield* tick;
				stale?.({ reason: 1, text: "old" });
				state.recognize?.({ reason: 1, text: "new" });
				expect(yield* Fiber.join(second)).toBe("new");
				expect(state.configs).toHaveLength(2);
			}),
	);
	it.effect("stop-to-final deadline closes recognition", () =>
		Effect.gen(function* () {
			const fiber = yield* AiSpeechService.recognize(
				stt,
				Stream.make(new Uint8Array(960)),
			).pipe(Effect.provide(layer), Effect.either, Effect.fork);
			yield* tick;
			yield* TestClock.adjust("15 seconds");
			expect(yield* Fiber.join(fiber)).toMatchObject({
				_tag: "Left",
				left: { phase: "final" },
			});
			expect(state.closed).toContain("recognizer");
		}),
	);
});

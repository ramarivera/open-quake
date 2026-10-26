import { createHmac } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import {
	Clock,
	Deferred,
	Effect,
	Fiber,
	Layer,
	Queue,
	Redacted,
	Stream,
	TestClock,
} from "effect";
import { AiCredentials } from "../ai-credentials.js";
import type { SttProfile, TtsProfile } from "./speech-contracts.js";
import { SpeechWebSocket } from "./speech-ports.js";
import { pcmResampler } from "./speech-resample.js";
import { AiSpeechService } from "./speech-service.js";
import { object } from "./speech-session.js";
import { sttProfile, ttsProfile } from "./speech-test-fixtures.js";
import { signXfy } from "./xfy.js";

const openai: SttProfile = {
	...sttProfile,
	provider: "openai",
	baseUrl: "wss://api.openai.com/v1/realtime?intent=transcription",
	model: "gpt-transcribe",
	language: "de",
};
const xfy: SttProfile = {
	...sttProfile,
	provider: "xfy",
	baseUrl: "wss://iat-api.xfyun.cn/v2/iat",
	model: "iat",
	language: "en_us",
};
const qwen: TtsProfile = {
	...ttsProfile,
	provider: "qwen-realtime",
	baseUrl:
		"wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-tts-flash-realtime",
	model: "qwen3-tts-flash-realtime",
	voice: "Cherry",
	format: "pcm",
	realtimeEnabled: true,
};
const xfyTts: TtsProfile = {
	...ttsProfile,
	provider: "xfy",
	baseUrl: "wss://tts-api.xfyun.cn/v2/tts",
	model: "xfy-tts",
	voice: "aisxping",
	language: "en_us",
	format: "pcm",
};
const tick = Effect.yieldNow().pipe(Effect.repeatN(12));
const fixture = Effect.fn("ProviderTest.fixture")(function* (
	respond: (event: Record<string, unknown>) => readonly unknown[] = () => [],
	secret = "speech-only-key",
) {
	const messages = yield* Queue.unbounded<unknown>();
	const sent: Record<string, unknown>[] = [];
	const opened = yield* Deferred.make<void>();
	let closed = 0,
		aborted = false;
	const inputs: { url: string; headers: Readonly<Record<string, string>> }[] =
		[];
	const transport: typeof SpeechWebSocket.Service = {
		connect: (input) =>
			Effect.sync(() => {
				inputs.push(input);
				input.signal.addEventListener("abort", () => {
					aborted = true;
				});
				return {
					receive: Queue.take(messages),
					close: Effect.sync(() => {
						closed++;
					}),
					send: (data) =>
						Effect.gen(function* () {
							if (typeof data !== "string")
								return yield* Effect.die("Expected JSON protocol");
							const event: unknown = JSON.parse(data);
							const record = object(event);
							sent.push(record);
							yield* Deferred.succeed(opened, undefined);
							yield* Queue.offerAll(messages, respond(record));
						}),
				};
			}),
	};
	const layer = AiSpeechService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(SpeechWebSocket, transport),
				Layer.succeed(AiCredentials, {
					resolve: () => Effect.succeed(Redacted.make(secret)),
					revoked: () => Effect.never,
				}),
			),
		),
	);
	return {
		messages,
		sent,
		opened,
		inputs,
		layer,
		state: () => ({ closed, aborted }),
	};
});
const frame = () => new Uint8Array(960);
const committed = {
	type: "input_audio_buffer.committed",
	item_id: "item-1",
	previous_item_id: null,
};
const final = {
	type: "conversation.item.input_audio_transcription.completed",
	item_id: "item-1",
	transcript: "turn left",
};
describe("independent speech provider conformance", () => {
	it.effect(
		"OpenAI waits for session.updated, sends transcription-only 24kHz config, commits once and replaces deltas",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture((e) =>
					e.type === "input_audio_buffer.commit"
						? [
								committed,
								{
									type: "conversation.item.input_audio_transcription.delta",
									item_id: "item-1",
									delta: "turn",
								},
								final,
								final,
							]
						: [],
				);
				const updates: string[] = [];
				const fiber = yield* AiSpeechService.recognize(
					openai,
					Stream.make(frame()),
					(t) =>
						Effect.sync(() => {
							updates.push(t.text);
						}),
				).pipe(Effect.provide(f.layer), Effect.fork);
				yield* Deferred.await(f.opened);
				expect(f.sent).toHaveLength(1);
				expect(f.sent[0]).toMatchObject({
					type: "session.update",
					session: {
						type: "transcription",
						audio: {
							input: {
								format: { type: "audio/pcm", rate: 24000 },
								transcription: { model: "gpt-transcribe", language: "de" },
								turn_detection: null,
							},
						},
					},
				});
				yield* Queue.offer(f.messages, { type: "session.created" });
				yield* tick;
				expect(f.sent).toHaveLength(1);
				yield* Queue.offer(f.messages, { type: "session.updated" });
				expect(yield* Fiber.join(fiber)).toBe("turn left");
				expect(f.sent.map((e) => e.type)).toEqual([
					"session.update",
					"input_audio_buffer.append",
					"input_audio_buffer.commit",
				]);
				expect(updates).toEqual(["turn", "turn left", "turn left"]);
				expect(f.inputs[0]?.headers).toEqual({
					Authorization: "Bearer speech-only-key",
				});
				expect(f.state()).toEqual({ closed: 1, aborted: true });
			}),
	);
	it.effect("OpenAI empty capture never commits", () =>
		Effect.gen(function* () {
			const f = yield* fixture((e) =>
				e.type === "session.update" ? [{ type: "session.updated" }] : [],
			);
			expect(
				yield* AiSpeechService.recognize(openai, Stream.empty).pipe(
					Effect.provide(f.layer),
				),
			).toBe("");
			expect(f.sent.map((e) => e.type)).toEqual(["session.update"]);
			expect(f.state().closed).toBe(1);
		}),
	);
	it.effect(
		"OpenAI handles a server-committed final before release without a duplicate commit",
		() =>
			Effect.gen(function* () {
				const release = yield* Deferred.make<void>();
				const f = yield* fixture((e) =>
					e.type === "session.update"
						? [{ type: "session.updated" }]
						: e.type === "input_audio_buffer.append"
							? [committed, final]
							: [],
				);
				const fiber = yield* AiSpeechService.recognize(
					openai,
					Stream.concat(
						Stream.make(frame()),
						Stream.fromEffect(Deferred.await(release)).pipe(Stream.drain),
					),
				).pipe(Effect.provide(f.layer), Effect.fork);
				yield* tick;
				yield* Deferred.succeed(release, undefined);
				expect(yield* Fiber.join(fiber)).toBe("turn left");
				expect(
					f.sent.filter((e) => e.type === "input_audio_buffer.commit"),
				).toHaveLength(0);
			}),
	);
	for (const phase of ["configure", "final"] as const)
		it.effect(`OpenAI ${phase} timeout closes the session`, () =>
			Effect.gen(function* () {
				const f = yield* fixture((e) =>
					phase === "final" && e.type === "session.update"
						? [{ type: "session.updated" }]
						: [],
				);
				const fiber = yield* AiSpeechService.recognize(
					openai,
					Stream.make(frame()),
				).pipe(Effect.provide(f.layer), Effect.either, Effect.fork);
				yield* tick;
				yield* TestClock.adjust(
					phase === "final" ? "15 seconds" : "10 seconds",
				);
				expect(yield* Fiber.join(fiber)).toMatchObject({
					_tag: "Left",
					left: { phase },
				});
				expect(f.state()).toEqual({ closed: 1, aborted: true });
			}),
		);
	it.effect("cancel discards late events and closes only the old session", () =>
		Effect.gen(function* () {
			const f = yield* fixture();
			const fiber = yield* AiSpeechService.recognize(
				openai,
				Stream.make(frame()),
			).pipe(Effect.provide(f.layer), Effect.fork);
			yield* Deferred.await(f.opened);
			yield* Fiber.interrupt(fiber);
			yield* Queue.offerAll(f.messages, [
				{ type: "session.updated" },
				committed,
				final,
			]);
			expect(f.sent).toHaveLength(1);
			expect(f.state()).toEqual({ closed: 1, aborted: true });
		}),
	);
	it.effect("XFY signs host/date/request line with HMAC SHA256", () =>
		Effect.gen(function* () {
			const auth = {
				appId: "fixture-app",
				apiKey: "fixture-key",
				apiSecret: "fixture-secret",
			};
			const url = new URL(yield* signXfy(xfy.baseUrl, auth));
			const date = new Date(yield* Clock.currentTimeMillis).toUTCString();
			const expected = createHmac("sha256", auth.apiSecret)
				.update(`host: iat-api.xfyun.cn\ndate: ${date}\nGET /v2/iat HTTP/1.1`)
				.digest("base64");
			expect(atob(url.searchParams.get("authorization") ?? "")).toBe(
				`api_key="fixture-key", algorithm="hmac-sha256", headers="host date request-line", signature="${expected}"`,
			);
			expect(url.searchParams.get("date")).toBe(date);
		}),
	);
	it.effect(
		"XFY sends 16kHz 0/1/2 frames and replaces an inclusive wpgs range",
		() =>
			Effect.gen(function* () {
				const event = (sn: number, text: string, extra: object = {}) => ({
					code: 0,
					data: {
						status: 1,
						result: { sn, ws: [{ cw: [{ w: text }] }], ...extra },
					},
				});
				const f = yield* fixture(
					(e) =>
						object(e.data).status === 2
							? [
									event(1, "a"),
									event(2, "b"),
									event(3, "c"),
									event(4, "fixed", { pgs: "rpl", rg: [1, 3] }),
									{ code: 0, data: { status: 2 } },
								]
							: [],
					JSON.stringify({ appId: "app", apiKey: "key", apiSecret: "secret" }),
				);
				expect(
					yield* AiSpeechService.recognize(
						xfy,
						Stream.make(frame(), frame()),
					).pipe(Effect.provide(f.layer)),
				).toBe("fixed");
				expect(f.sent.map((e) => object(e.data).status)).toEqual([0, 1, 2]);
				expect(f.sent[0]).toMatchObject({
					common: { app_id: "app" },
					business: { language: "en_us", dwa: "wpgs" },
					data: { format: "audio/L16;rate=16000", encoding: "raw" },
				});
				expect(atob(String(object(f.sent[0]?.data).audio))).toHaveLength(640);
				expect(f.state().closed).toBe(1);
			}),
	);
	it.effect(
		"XFY synthesis encodes UTF8 and converts raw 16kHz output to 24kHz",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture(
					() => [
						{ code: 0, data: { status: 1, audio: "AAABAA==" } },
						{ code: 0, data: { status: 2, audio: "AgADAA==" } },
					],
					JSON.stringify({ appId: "app", apiKey: "key", apiSecret: "secret" }),
				);
				const audio = yield* AiSpeechService.synthesize(xfyTts, "héllo").pipe(
					Effect.provide(f.layer),
				);
				expect(audio.bytes.length).toBe(12);
				expect(audio.descriptor.sampleRate).toBe(24000);
				expect(f.sent[0]).toMatchObject({
					common: { app_id: "app" },
					business: {
						vcn: "aisxping",
						aue: "raw",
						auf: "audio/L16;rate=16000",
						tte: "UTF8",
					},
					data: { status: 2 },
				});
				expect(
					new TextDecoder().decode(
						Uint8Array.from(atob(String(object(f.sent[0]?.data).text)), (c) =>
							c.charCodeAt(0),
						),
					),
				).toBe("héllo");
			}),
	);
	it.effect(
		"Qwen realtime waits for ack then appends/commits and requires correlated response.done",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture((e) =>
					e.type === "input_text_buffer.commit"
						? [
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
							]
						: [],
				);
				const fiber = yield* AiSpeechService.synthesize(qwen, "hello").pipe(
					Effect.provide(f.layer),
					Effect.fork,
				);
				yield* Deferred.await(f.opened);
				expect(f.sent).toHaveLength(1);
				yield* Queue.offer(f.messages, { type: "session.updated" });
				expect((yield* Fiber.join(fiber)).bytes).toHaveLength(4);
				expect(f.sent.map((e) => e.type)).toEqual([
					"session.update",
					"input_text_buffer.append",
					"input_text_buffer.commit",
					"session.finish",
				]);
				expect(f.state().closed).toBe(1);
			}),
	);
	it.effect(
		"Qwen cancellation clears, finishes and closes, and requires explicit opt in",
		() =>
			Effect.gen(function* () {
				const f = yield* fixture((e) =>
					e.type === "session.update" ? [{ type: "session.updated" }] : [],
				);
				const denied = yield* AiSpeechService.synthesize(
					{ ...qwen, realtimeEnabled: false },
					"hello",
				).pipe(Effect.provide(f.layer), Effect.either);
				expect(denied).toMatchObject({
					_tag: "Left",
					left: { _tag: "AiConfigInvalid" },
				});
				expect(f.sent).toHaveLength(0);
				const fiber = yield* AiSpeechService.synthesize(qwen, "hello").pipe(
					Effect.provide(f.layer),
					Effect.fork,
				);
				yield* tick;
				yield* Fiber.interrupt(fiber);
				expect(f.sent.map((e) => e.type)).toContain("input_text_buffer.clear");
				expect(f.sent.at(-1)?.type).toBe("session.finish");
				expect(f.state().closed).toBe(1);
			}),
	);
	it("resampling retains phase across unequal frame boundaries", () => {
		const input = new Uint8Array(1800);
		const view = new DataView(input.buffer);
		for (let i = 0; i < 900; i++) view.setInt16(i * 2, i * 10, true);
		for (const [source, target] of [
			[24000, 16000],
			[16000, 24000],
		]) {
			if (!source || !target) throw new Error("Fixture");
			const whole = pcmResampler(source, target)(input, true);
			const convert = pcmResampler(source, target);
			const parts = [
				convert(input.slice(0, 482)),
				convert(input.slice(482, 996)),
				convert(input.slice(996), true),
			];
			expect(Buffer.concat(parts)).toEqual(Buffer.from(whole));
		}
	});
});

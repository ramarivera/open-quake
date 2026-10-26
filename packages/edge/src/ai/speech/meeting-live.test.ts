import { it } from "@effect/vitest";
import {
	Clock,
	Effect,
	Either,
	Fiber,
	Option,
	Queue,
	Stream,
	TestClock,
} from "effect";
import { describe, expect } from "vitest";
import { defaultMeetingConfig } from "../../meetings/meeting-defaults.js";
import { meetingError } from "../../meetings/meeting-errors.js";
import { AiProtocolInvalid } from "../ai-errors.js";
import { transcribeMeeting } from "../meeting-adapter.js";
import { dashscopeFiletrans, FILETRANS_MODEL } from "./dashscope-filetrans.js";
import { meetingFileHygiene } from "./meeting-file-hygiene.js";
import { makeLiveMeetingAdapter } from "./meeting-live.js";
import { makeMeetingTranslation } from "./meeting-realtime.js";
import type { MeetingResource, MeetingResources } from "./meeting-resources.js";
import type {
	SpeechHttp,
	SpeechSocket,
	SpeechWebSocket,
} from "./speech-ports.js";
import { object } from "./speech-session.js";

function fixture() {
	const states = new Map<string, MeetingResource>();
	const artifacts: unknown[] = [];
	let audioMissing = false;
	let released = 0;
	const resources: MeetingResources = {
		load: (ref) => Effect.sync(() => states.get(ref)),
		save: (ref, state) =>
			Effect.sync(() => {
				states.set(ref, structuredClone(state));
			}),
		audio: () =>
			audioMissing
				? Effect.fail(meetingError("AudioMissing"))
				: Effect.succeed({
						blob: new Blob(["mono-mp3"]),
						release: Effect.sync(() => {
							released++;
						}),
					}),
		pcm: () =>
			Effect.succeed({
				frames: Stream.make(new Uint8Array(4800)),
				release: Effect.sync(() => {
					released++;
				}),
			}),
		artifacts: (_ref, raw, segments) =>
			Effect.sync(() => {
				artifacts.push({ raw, segments });
			}),
	};
	const resolve = () =>
		Effect.succeed({
			key: "fake-secret",
			api: "http://127.0.0.1:1234/api/v1/",
			realtime: "ws://127.0.0.1:1234/realtime",
		});
	const requests: { url: string; init: RequestInit }[] = [];
	let failed = false;
	let noSpeech = false;
	let internalFailures = 0;
	const http: typeof SpeechHttp.Service = {
		fetch: async (url, init) => {
			requests.push({ url, init });
			if (url.includes("uploads?"))
				return Response.json({
					data: {
						upload_host: "http://127.0.0.1:1234/oss",
						upload_dir: "private",
						oss_access_key_id: "oss-id",
						signature: "signature",
						policy: "policy",
					},
				});
			if (url.endsWith("/oss")) return new Response("");
			if (url.endsWith("/transcription"))
				return Response.json({
					output: {
						task_id: `task-${requests.length}`,
						task_status: "PENDING",
					},
				});
			if (url.includes("/cancel")) return Response.json({});
			if (url.includes("/tasks/")) {
				const internal = internalFailures-- > 0;
				return Response.json({
					output: {
						task_id: states.get("meeting")?.task,
						task_status: failed || internal ? "FAILED" : "SUCCEEDED",
						code: failed
							? "FILE_DOWNLOAD_FAILED"
							: internal
								? "InternalError"
								: undefined,
						results: [
							{
								subtask_status: "SUCCEEDED",
								transcription_url: "http://127.0.0.1:1234/result",
							},
						],
					},
				});
			}
			if (url.endsWith("/result"))
				return Response.json({
					transcripts: [
						{
							sentences: noSpeech
								? []
								: [
										{
											speaker_id: 2,
											begin_time: 200,
											end_time: 300,
											text: "second",
										},
										{
											speaker_id: 1,
											begin_time: 0,
											end_time: 200,
											text: "Grüße",
										},
									],
						},
					],
				});
			if (url.endsWith("/files") && init.method === "POST")
				return Response.json({ id: "owned-file" });
			if (url.endsWith("/files"))
				return Response.json({
					data: [{ id: "owned-file" }, { id: "other-account-file" }],
				});
			if (url.includes("/files/"))
				return new Response("", { status: failed ? 500 : 200 });
			throw new Error("Unexpected fake URL");
		},
	};
	const request = {
		audioRef: "meeting",
		durationMs: 300,
		config: {
			...defaultMeetingConfig,
			asrProvider: "dashscope" as const,
			asrModel: FILETRANS_MODEL,
		},
		channelIds: [0],
		diarization: true,
		expiresInMs: 48 * 3600000,
	};
	return {
		states,
		resources,
		resolve,
		http,
		requests,
		request,
		artifacts,
		missing: () => {
			audioMissing = true;
		},
		fail: (value = true) => {
			failed = value;
		},
		internalFailures: (n: number) => {
			internalFailures = n;
		},
		noSpeech: () => {
			noSpeech = true;
		},
		released: () => released,
	};
}
describe("direct meeting provider resources", () => {
	it.effect(
		"uploads private OSS, matches model and mono plan, persists ordered artifacts and resumes after restart",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				let adapter = dashscopeFiletrans(f);
				yield* adapter.submit(f.request);
				expect(f.states.get("meeting")?.upload?.expiresAt).toBe(
					(yield* Clock.currentTimeMillis) + 48 * 3600000,
				);
				expect(f.released()).toBe(1);
				const upload = f.requests.find((r) => r.url.endsWith("/oss"));
				expect(upload?.init.headers).toBeUndefined();
				expect(upload?.init.body).toBeInstanceOf(FormData);
				if (!(upload?.init.body instanceof FormData))
					throw new Error("No form");
				expect(upload.init.body.get("x-oss-object-acl")).toBe("private");
				expect(upload.init.body.get("file")).toBeInstanceOf(Blob);
				const sent = JSON.parse(
					String(
						f.requests.find((r) => r.url.endsWith("/transcription"))?.init.body,
					),
				);
				expect(sent).toMatchObject({
					model: FILETRANS_MODEL,
					parameters: { channel_id: [0], diarization_enabled: true },
				});
				adapter = dashscopeFiletrans(f);
				yield* adapter.submit(f.request);
				expect(
					f.requests.filter((r) => r.url.endsWith("/transcription")),
				).toHaveLength(1);
				expect(yield* adapter.poll("meeting")).toMatchObject({
					status: "complete",
					segments: [
						{ text: "Grüße", startMs: 0 },
						{ text: "second", startMs: 200 },
					],
				});
				expect(f.artifacts).toHaveLength(1);
			}),
	);
	it.effect(
		"reuploads expired resources, preserves identity, distinguishes expired deleted audio and never invents speech",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const adapter = dashscopeFiletrans(f);
				yield* adapter.submit(f.request);
				f.fail();
				expect(
					Either.isLeft(yield* Effect.either(adapter.poll("meeting"))),
				).toBe(true);
				f.fail(false);
				yield* adapter.submit(f.request);
				expect(f.requests.filter((r) => r.url.endsWith("/oss"))).toHaveLength(
					2,
				);
				f.noSpeech();
				const empty = yield* Effect.either(adapter.poll("meeting"));
				expect(Either.isLeft(empty) && empty.left.code).toBe(
					"QUAKE.MEETING.NO_VALID_SPEECH",
				);
				const state = f.states.get("meeting");
				if (!state) throw new Error("No state");
				f.states.set("meeting", {
					...state,
					task: undefined,
					upload: { url: "oss://old", expiresAt: 0 },
				});
				f.missing();
				const missing = yield* Effect.either(adapter.submit(f.request));
				expect(Either.isLeft(missing) && missing.left.code).toBe(
					"QUAKE.MEETING.AUDIO_EXPIRED",
				);
			}),
	);
	it.effect(
		"cancels the persisted task and scopes remote file hygiene to local ownership with retryable failures",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const adapter = dashscopeFiletrans(f);
				yield* adapter.submit(f.request);
				yield* adapter.cancel("meeting");
				expect(f.states.get("meeting")?.task).toBeUndefined();
				const files = meetingFileHygiene(f.http, f.resources, f.resolve);
				yield* files.upload("meeting", "private transcript");
				expect(yield* files.list("meeting")).toEqual([{ id: "owned-file" }]);
				expect(
					Either.isLeft(
						yield* Effect.either(files.remove("meeting", "other-account-file")),
					),
				).toBe(true);
				expect(
					f.requests.some((r) => r.url.endsWith("/other-account-file")),
				).toBe(false);
				f.fail();
				expect(
					Either.isLeft(yield* Effect.either(files.cleanup("meeting"))),
				).toBe(true);
				expect(f.states.get("meeting")).toMatchObject({
					remoteFiles: ["owned-file"],
					cleanupPending: true,
				});
				f.fail(false);
				yield* files.cleanup("meeting");
				expect(f.states.get("meeting")).toMatchObject({
					remoteFiles: [],
					cleanupPending: false,
				});
			}),
	);
});
function fakeSocket(transcript = "file transcript") {
	return Effect.gen(function* () {
		const queue = yield* Queue.unbounded<unknown>();
		const events: Record<string, unknown>[] = [];
		let closed = 0;
		const socket: SpeechSocket = {
			send: (raw) =>
				Effect.gen(function* () {
					const e = object(JSON.parse(String(raw)));
					events.push(e);
					if (e.type === "session.update")
						yield* Queue.offer(queue, { type: "session.updated" });
					if (e.type === "input_audio_buffer.commit") {
						yield* Queue.offer(queue, {
							type: "input_audio_buffer.committed",
							item_id: "one",
						});
						yield* Queue.offer(queue, {
							type: "conversation.item.input_audio_transcription.completed",
							item_id: "one",
							transcript,
						});
					}
				}),
			receive: Queue.take(queue).pipe(
				Effect.flatMap((item) =>
					item === "disconnect"
						? Effect.fail(new AiProtocolInvalid())
						: Effect.succeed(item),
				),
			),
			close: Effect.sync(() => {
				closed++;
			}),
		};
		let connections = 0;
		const transport: typeof SpeechWebSocket.Service = {
			connect: () =>
				Effect.sync(() => {
					connections++;
					return socket;
				}),
		};
		return {
			queue,
			events,
			socket,
			transport,
			closed: () => closed,
			connections: () => connections,
		};
	});
}
describe("file and live realtime ownership", () => {
	it.scoped(
		"paces file PCM, waits for finality, persists it and releases each concurrent job",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const sockets: Effect.Effect.Success<ReturnType<typeof fakeSocket>>[] =
					[];
				const transport: typeof SpeechWebSocket.Service = {
					connect: () =>
						fakeSocket().pipe(
							Effect.tap((s) =>
								Effect.sync(() => {
									sockets.push(s);
								}),
							),
							Effect.map((s) => s.socket),
						),
				};
				const adapter = yield* makeLiveMeetingAdapter({
					...f,
					socket: transport,
				});
				const config = {
					...f.request.config,
					asrProvider: "openai" as const,
					asrModel: "gpt-realtime-mini",
					outputLanguage: "en",
				};
				const fiber = yield* Effect.all(
					[
						adapter.submit({ ...f.request, config }),
						adapter.submit({ ...f.request, config, audioRef: "second" }),
					],
					{ concurrency: 2 },
				).pipe(Effect.fork);
				yield* TestClock.adjust(700);
				yield* Fiber.join(fiber);
				expect(sockets).toHaveLength(2);
				expect(f.released()).toBe(2);
				expect(sockets.every((s) => s.closed() === 1)).toBe(true);
				expect(f.states.get("meeting")?.segments).toMatchObject([
					{ startMs: 0, endMs: 100, text: "file transcript" },
				]);
				expect(sockets[0]?.events.map((e) => e.type)).toEqual([
					"session.update",
					"input_audio_buffer.append",
					"input_audio_buffer.commit",
				]);
			}),
	);
	it.scoped(
		"replaces correlated live text, reconnects after 500ms and rejects stale session output after stop",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const s = yield* fakeSocket();
				const live = yield* makeMeetingTranslation(s.transport, f.resolve);
				yield* live.prepareTranslation(f.request.config);
				const session = object(s.events[0]?.session);
				expect(session).toMatchObject({
					input_audio_format: "pcm16",
					translation: { language: "zh" },
					input_audio_transcription: { language: "auto" },
					modalities: ["text"],
				});
				yield* Queue.offer(s.queue, {
					type: "response.text.text",
					response_id: "r",
					text: "Hallo",
					stash: "!",
				});
				yield* Effect.yieldNow();
				expect(
					yield* live.translate(f.request.config, new Uint8Array(14400)),
				).toMatchObject([{ id: "0:r", text: "Hallo!", final: false }]);
				yield* Queue.offer(s.queue, {
					type: "response.text.done",
					response_id: "r",
					text: "Hallo!",
				});
				yield* Effect.yieldNow();
				expect(
					yield* live.translate(f.request.config, new Uint8Array(14400)),
				).toMatchObject([{ id: "0:r", final: true }]);
				yield* Queue.offer(s.queue, "disconnect");
				yield* Effect.yieldNow();
				const reconnect = yield* live
					.translate(f.request.config, new Uint8Array(14400))
					.pipe(Effect.fork);
				yield* TestClock.adjust(499);
				expect(s.connections()).toBe(1);
				yield* TestClock.adjust(1);
				yield* Fiber.join(reconnect);
				expect(s.connections()).toBe(2);
				yield* Queue.offer(s.queue, {
					type: "response.text.done",
					response_id: "r",
					text: "new connection",
				});
				yield* Effect.yieldNow();
				expect(
					yield* live.translate(f.request.config, new Uint8Array(14400)),
				).toMatchObject([{ id: "1:r", text: "new connection" }]);
				yield* live.stopTranslation();
				expect(s.closed()).toBe(2);
			}),
	);
	it.scoped(
		"bounds in-flight translation PCM and cancellation interrupts queued reconnects",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const s = yield* fakeSocket();
				const live = yield* makeMeetingTranslation(s.transport, f.resolve);
				yield* live.prepareTranslation(f.request.config);
				yield* Queue.offer(s.queue, "disconnect");
				yield* Effect.yieldNow();
				const fibers = yield* Effect.all(
					Array.from({ length: 8 }, () =>
						live
							.translate(f.request.config, new Uint8Array(14400))
							.pipe(Effect.either, Effect.fork),
					),
				);
				yield* Effect.yieldNow();
				const overflow = yield* Effect.either(
					live.translate(f.request.config, new Uint8Array(14400)),
				);
				expect(Either.isLeft(overflow) && overflow.left.code).toBe(
					"QUAKE.MEETING.INVALID",
				);
				yield* live.stopTranslation();
				yield* TestClock.adjust(500);
				yield* Effect.all(fibers.map(Fiber.join));
				expect(s.connections()).toBe(1);
			}),
	);
});

it.scoped(
	"AI-272 rejects no speech and releases per-job PCM on cancellation before file submission",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const empty = yield* fakeSocket("");
			const adapter = yield* makeLiveMeetingAdapter({
				...f,
				socket: empty.transport,
			});
			const config = {
				...f.request.config,
				asrProvider: "openai" as const,
				asrModel: "gpt-realtime-mini",
				outputLanguage: "en",
			};
			const job = yield* adapter
				.submit({ ...f.request, config })
				.pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(700);
			const result = yield* Fiber.join(job);
			expect(Either.isLeft(result) && result.left.code).toBe(
				"QUAKE.MEETING.NO_VALID_SPEECH",
			);
			expect(f.states.get("meeting")?.segments).toBeUndefined();
			expect(f.released()).toBe(1);
			const cancelled = yield* adapter
				.submit({ ...f.request, config, audioRef: "cancelled" })
				.pipe(Effect.fork);
			yield* Effect.yieldNow();
			yield* Fiber.interrupt(cancelled);
			expect(f.released()).toBe(2);
			expect(empty.closed()).toBe(2);
			expect(f.states.has("cancelled")).toBe(false);
		}),
);

it.effect(
	"AI-270 bounds InternalError task resubmission to three retries at 2/4/6 seconds",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const adapter = dashscopeFiletrans(f);
			yield* adapter.submit(f.request);
			f.internalFailures(4);
			for (let attempt = 1; attempt <= 3; attempt++) {
				const work = yield* adapter.poll("meeting").pipe(Effect.fork);
				yield* TestClock.adjust(2000 * attempt - 1);
				expect(
					f.requests.filter((r) => r.url.endsWith("/transcription")),
				).toHaveLength(attempt);
				yield* TestClock.adjust(1);
				expect(yield* Fiber.join(work)).toEqual({ status: "pending" });
			}
			expect(Either.isLeft(yield* Effect.either(adapter.poll("meeting")))).toBe(
				true,
			);
			expect(
				f.requests.filter((r) => r.url.endsWith("/transcription")),
			).toHaveLength(4);
		}),
);

it.scoped(
	"AI-272 cancellation interrupts production facade submission and releases PCM/socket before returning",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const s = yield* fakeSocket();
			const adapter = yield* makeLiveMeetingAdapter({
				...f,
				socket: s.transport,
			});
			const config = {
				...f.request.config,
				asrProvider: "openai" as const,
				asrModel: "gpt-realtime-mini",
			};
			const work = yield* transcribeMeeting(
				Option.some(adapter),
				config,
				"meeting",
				300,
			).pipe(Effect.fork);
			yield* Effect.yieldNow();
			yield* Fiber.interrupt(work);
			expect(f.released()).toBe(1);
			expect(s.closed()).toBe(1);
			expect(f.states.has("meeting")).toBe(false);
		}),
);

it.scoped(
	"AI-272 waits for all late segments, preserves VAD timings and times out with cleanup instead of saving partial speech",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const s = yield* fakeSocket();
			const transport: typeof SpeechWebSocket.Service = {
				connect: () =>
					Effect.succeed({
						...s.socket,
						send: (raw) => {
							const event = object(JSON.parse(String(raw)));
							if (event.type !== "input_audio_buffer.commit")
								return s.socket.send(raw);
							return Effect.gen(function* () {
								for (const [id, start, end] of [
									["first", 0, 100],
									["second", 100, 300],
								] as const) {
									yield* Queue.offer(s.queue, {
										type: "input_audio_buffer.speech_started",
										item_id: id,
										audio_start_ms: start,
									});
									yield* Queue.offer(s.queue, {
										type: "input_audio_buffer.speech_stopped",
										item_id: id,
										audio_end_ms: end,
									});
									yield* Queue.offer(s.queue, {
										type: "input_audio_buffer.committed",
										item_id: id,
									});
								}
							});
						},
					}),
			};
			const adapter = yield* makeLiveMeetingAdapter({
				...f,
				socket: transport,
			});
			const config = {
				...f.request.config,
				asrProvider: "openai" as const,
				asrModel: "gpt-realtime-mini",
			};
			const job = yield* adapter
				.submit({ ...f.request, config })
				.pipe(Effect.fork);
			yield* TestClock.adjust(600);
			expect(object(s.events[0]?.session)).toMatchObject({
				type: "realtime",
				audio: {
					input: {
						transcription: { model: "gpt-4o-transcribe" },
						turn_detection: {
							threshold: 0.4,
							prefix_padding_ms: 800,
							silence_duration_ms: 1000,
						},
					},
				},
			});
			yield* Queue.offer(s.queue, {
				type: "conversation.item.input_audio_transcription.completed",
				item_id: "first",
				transcript: "first",
			});
			yield* Effect.yieldNow();
			expect(Option.isNone(yield* Fiber.poll(job))).toBe(true);
			yield* TestClock.adjust(9000);
			yield* Queue.offer(s.queue, {
				type: "conversation.item.input_audio_transcription.completed",
				item_id: "second",
				transcript: "late",
			});
			yield* Fiber.join(job);
			expect(f.states.get("meeting")?.segments).toMatchObject([
				{ startMs: 0, endMs: 100, text: "first" },
				{ startMs: 100, endMs: 300, text: "late" },
			]);
			const timed = yield* adapter
				.submit({ ...f.request, config, audioRef: "timeout" })
				.pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(10600);
			const failure = yield* Fiber.join(timed);
			expect(Either.isLeft(failure) && failure.left.code).toBe(
				"QUAKE.MEETING.TIMEOUT",
			);
			expect(f.states.has("timeout")).toBe(false);
			expect(f.released()).toBe(2);
			expect(s.closed()).toBe(2);
		}),
);

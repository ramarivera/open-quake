import { it } from "@effect/vitest";
import {
	Clock,
	Deferred,
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
			revoked: Effect.never,
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
	for (const missingAudio of [false, true]) {
		it.effect(
			`failed FILE_DOWNLOAD_FAILED subtask invalidates durable upload before retry, missing audio=${missingAudio}`,
			() =>
				Effect.gen(function* () {
					const f = fixture();
					const options = {
						...f,
						http: {
							fetch: async (url: string, init: RequestInit) =>
								url.includes("/tasks/")
									? Response.json({
											output: {
												task_id: f.states.get("meeting")?.task,
												task_status: "SUCCEEDED",
												results: [
													{
														subtask_status: "FAILED",
														code: "FILE_DOWNLOAD_FAILED",
														message: "FILE_DOWNLOAD_FAILED",
													},
												],
											},
										})
									: f.http.fetch(url, init),
						},
					};
					const adapter = dashscopeFiletrans(options);
					yield* adapter.submit(f.request);
					const previousUpload = f.states.get("meeting")?.upload?.url;
					const result = yield* adapter.poll("meeting").pipe(Effect.either);
					expect(Either.isLeft(result) && result.left.code).toBe(
						"QUAKE.MEETING.TRANSCRIPTION_FAILED",
					);
					expect(f.states.get("meeting")?.task).toBeUndefined();
					expect(f.states.get("meeting")?.upload?.expiresAt).toBe(0);
					if (missingAudio) f.missing();
					const retry = yield* dashscopeFiletrans(options)
						.submit(f.request)
						.pipe(Effect.either);
					if (missingAudio) {
						expect(Either.isLeft(retry) && retry.left.code).toBe(
							"QUAKE.MEETING.AUDIO_EXPIRED",
						);
						expect(
							f.requests.filter((r) => r.url.endsWith("/transcription")),
						).toHaveLength(1);
					} else {
						expect(Either.isRight(retry)).toBe(true);
						expect(
							f.requests.filter((r) => r.url.endsWith("/oss")),
						).toHaveLength(2);
						expect(f.states.get("meeting")?.upload?.url).not.toBe(
							previousUpload,
						);
						expect(
							f.requests.filter((r) => r.url.endsWith("/transcription")),
						).toHaveLength(2);
					}
				}),
		);
	}
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
for (const provisionalId of ["vad-provisional", "one"]) {
	it.scoped(
		`OpenAI EOF waits only for committed items after speech_started ${provisionalId}`,
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const s = yield* fakeSocket();
				const adapter = yield* makeLiveMeetingAdapter({
					...f,
					socket: {
						connect: () =>
							Effect.succeed({
								...s.socket,
								send: (raw) =>
									s.socket.send(raw).pipe(
										Effect.zipRight(
											object(JSON.parse(String(raw))).type ===
												"input_audio_buffer.append"
												? Queue.offer(s.queue, {
														type: "input_audio_buffer.speech_started",
														item_id: provisionalId,
														audio_start_ms: 30,
													}).pipe(Effect.asVoid)
												: Effect.void,
										),
									),
							}),
					},
				});
				const config = {
					...f.request.config,
					asrProvider: "openai" as const,
					asrModel: "gpt-realtime-mini",
				};
				const job = yield* adapter
					.submit({ ...f.request, config })
					.pipe(Effect.either, Effect.fork);
				yield* TestClock.adjust(10600);
				expect(Either.isRight(yield* Fiber.join(job))).toBe(true);
				expect(f.states.get("meeting")?.segments).toEqual([
					{
						id: "one",
						speaker: "",
						startMs: 30,
						endMs: 100,
						text: "file transcript",
					},
				]);
				expect(f.released()).toBe(1);
				expect(s.closed()).toBe(1);
			}),
	);
}
describe("file and live realtime ownership", () => {
	it.scoped(
		"uses documented LiveTranslate PCM settings and sends resampled 16 kHz signed audio",
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
								if (event.type === "session.update") {
									expect(event.session).toMatchObject({
										input_audio_format: "pcm",
										sample_rate: 16000,
									});
								}
								return s.socket.send(raw);
							},
						}),
				};
				const live = yield* makeMeetingTranslation(transport, f.resolve);
				for (let block = 0; block < 2; block++) {
					const backing = new Uint8Array(14404);
					const pcm = backing.subarray(2, 14402);
					const input = new DataView(
						pcm.buffer,
						pcm.byteOffset,
						pcm.byteLength,
					);
					for (let i = 0; i < 7200; i++)
						input.setInt16(i * 2, i * 4 - 20000 + block, true);
					yield* live.translate(f.request.config, pcm);
					const event = s.events.filter(
						(e) => e.type === "input_audio_buffer.append",
					)[block];
					if (typeof event?.audio !== "string")
						throw new Error("No wire audio");
					const bytes = Buffer.from(event.audio, "base64");
					expect(bytes.length).toBe(9600);
					for (let i = 0; i < 4800; i++)
						expect(bytes.readInt16LE(i * 2)).toBe(i * 6 - 20000 + block);
				}
				expect(
					s.events.filter((e) => e.type === "session.update"),
				).toHaveLength(1);
				for (const length of [9600, 14398, 14402]) {
					const result = yield* live
						.translate(f.request.config, new Uint8Array(length))
						.pipe(Effect.either);
					expect(Either.isLeft(result) && result.left.code).toBe(
						"QUAKE.MEETING.INVALID",
					);
				}
				expect(
					s.events.filter((e) => e.type === "input_audio_buffer.append"),
				).toHaveLength(2);
			}),
	);
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
					"session.update",
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
					input_audio_format: "pcm",
					sample_rate: 16000,
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

it.scoped(
	"AI-137 AI-338 live result queues retain final text and cap total characters before any consumer drains",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const s = yield* fakeSocket();
			const live = yield* makeMeetingTranslation(s.transport, f.resolve);
			yield* live.prepareTranslation(f.request.config);
			yield* Queue.offer(s.queue, {
				type: "response.text.done",
				response_id: "final",
				text: "committed",
			});
			yield* Queue.offer(s.queue, {
				type: "response.text.text",
				response_id: "final",
				text: "stale interim",
			});
			yield* Effect.yieldNow();
			expect(
				yield* live.translate(f.request.config, new Uint8Array(14400)),
			).toMatchObject([{ text: "committed", final: true }]);
			for (let i = 0; i < 40; i++)
				yield* Queue.offer(s.queue, {
					type: "response.text.done",
					response_id: String(i),
					text: "x".repeat(5000),
				});
			yield* Effect.yieldNow();
			const result = yield* live.translate(
				f.request.config,
				new Uint8Array(14400),
			);
			expect(result.length).toBeGreaterThan(0);
			expect(result.length).toBeLessThanOrEqual(200);
			expect(result.reduce((n, u) => n + u.text.length, 0)).toBeLessThanOrEqual(
				64000,
			);
			expect(result.every((u) => u.text.length <= 4000)).toBe(true);
		}),
);

for (const target of [
	"http://127.0.0.1:1234/result",
	"https://127.0.0.1/result",
	"https://10.1.2.3/result",
	"https://172.16.0.1/result",
	"https://192.168.1.1/result",
	"https://169.254.169.254/latest/meta-data",
	"https://[::1]/result",
	"https://[::ffff:7f00:1]/result",
	"https://[fd00::1]/result",
	"https://[fe80::1]/result",
	"https://localhost/result",
	"https://metadata.google.internal/result",
	"https://2130706433/result",
	"https://attacker.example/result",
]) {
	it.effect(
		`rejects provider-supplied transcript URL ${target} before fetching`,
		() =>
			Effect.gen(function* () {
				const f = fixture();
				f.states.set("meeting", {
					version: 1,
					config: f.request.config,
					task: "task",
					remoteFiles: [],
					cleanupPending: false,
				});
				const http: typeof SpeechHttp.Service = {
					fetch: async (url, init) => {
						if (url.endsWith("/tasks/task"))
							return Response.json({
								output: {
									task_id: "task",
									task_status: "SUCCEEDED",
									results: [
										{ subtask_status: "SUCCEEDED", transcription_url: target },
									],
								},
							});
						return f.http.fetch(url, init);
					},
				};
				const adapter = dashscopeFiletrans({
					...f,
					http,
					resolve: () =>
						Effect.succeed({
							key: "fake",
							revoked: Effect.never,
							api: "https://dashscope.aliyuncs.com/api/v1/",
							realtime: "wss://dashscope.aliyuncs.com/realtime",
						}),
				});
				const result = yield* Effect.either(adapter.poll("meeting"));
				expect(Either.isLeft(result)).toBe(true);
				expect(f.requests).toEqual([]);
			}),
	);
}

for (const host of [
	"https://attacker.example",
	"https://personal-bucket.oss-cn-beijing.aliyuncs.com",
	"https://dashscope-file-example.oss-cn-beijing.aliyuncs.com.attacker.example",
	"https://dashscope-file-example.oss-cn-beijing.aliyuncs.com:444",
]) {
	it.effect(`rejects unrelated audio upload policy host ${host}`, () =>
		Effect.gen(function* () {
			const f = fixture();
			const http: typeof SpeechHttp.Service = {
				fetch: async (url, init) => {
					if (url.includes("uploads?"))
						return Response.json({
							data: {
								upload_host: host,
								upload_dir: "private",
								oss_access_key_id: "fake",
								signature: "fake",
								policy: "fake",
							},
						});
					return f.http.fetch(url, init);
				},
			};
			const adapter = dashscopeFiletrans({ ...f, http });
			expect(
				Either.isLeft(yield* Effect.either(adapter.submit(f.request))),
			).toBe(true);
			expect(f.requests).toEqual([]);
			expect(f.released()).toBe(0);
		}),
	);
}

for (const empty of [false, true]) {
	it.scoped(
		`waits for the explicit EOF flush after a late VAD turn, empty=${empty}`,
		() =>
			Effect.gen(function* () {
				const f = fixture();
				const s = yield* fakeSocket();
				let updates = 0;
				let flushId: unknown;
				let barrier = false;
				const automatic = Queue.offerAll(s.queue, [
					{ type: "input_audio_buffer.committed", item_id: "vad" },
					{
						type: "conversation.item.input_audio_transcription.completed",
						item_id: "vad",
						transcript: "earlier turn",
					},
				]);
				const transport: typeof SpeechWebSocket.Service = {
					connect: () =>
						Effect.succeed({
							...s.socket,
							send: (raw) =>
								Effect.gen(function* () {
									const event = object(JSON.parse(String(raw)));
									if (event.type === "session.update") {
										if (++updates > 1) {
											yield* automatic;
											barrier = true;
										}
										yield* Queue.offer(s.queue, { type: "session.updated" });
									} else if (event.type === "input_audio_buffer.commit") {
										flushId = event.event_id;
										if (!barrier) yield* automatic;
									}
								}),
						}),
				};
				const adapter = yield* makeLiveMeetingAdapter({
					...f,
					socket: transport,
				});
				const request = {
					...f.request,
					config: {
						...f.request.config,
						asrProvider: "openai" as const,
						asrModel: "gpt-realtime-mini",
					},
				};
				const job = yield* adapter.submit(request).pipe(Effect.fork);
				yield* TestClock.adjust(700);
				expect(Option.isNone(yield* Fiber.poll(job))).toBe(true);
				expect(f.states.has("meeting")).toBe(false);
				if (empty)
					yield* Queue.offer(s.queue, {
						type: "error",
						error: {
							code: "input_audio_buffer_commit_empty",
							event_id: flushId,
						},
					});
				else
					yield* Queue.offerAll(s.queue, [
						{
							type: "input_audio_buffer.committed",
							item_id: "tail",
							previous_item_id: "vad",
						},
						{
							type: "conversation.item.input_audio_transcription.completed",
							item_id: "tail",
							transcript: "final tail",
						},
					]);
				yield* Fiber.join(job);
				expect(f.states.get("meeting")?.segments?.map((s) => s.text)).toEqual(
					empty ? ["earlier turn"] : ["earlier turn", "final tail"],
				);
			}),
	);
}

it.effect(
	"resubmits completed DashScope speech while recovering pending tasks",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const http: typeof SpeechHttp.Service = {
				fetch: async (url, init) => {
					if (url.endsWith("/result"))
						return Response.json({
							transcripts: [
								{
									sentences: [
										{
											speaker_id: 1,
											begin_time: 0,
											end_time: 200,
											text:
												f.requests.filter((r) =>
													r.url.endsWith("/transcription"),
												).length === 1
													? "Ship Friday"
													: "Ship Monday",
										},
									],
								},
							],
						});
					return f.http.fetch(url, init);
				},
			};
			let adapter = dashscopeFiletrans({ ...f, http });
			yield* adapter.submit(f.request);
			yield* adapter.poll("meeting");
			adapter = dashscopeFiletrans({ ...f, http });
			yield* adapter.submit(f.request);
			expect(f.states.get("meeting")?.segments).toBeUndefined();
			expect(yield* adapter.poll("meeting")).toMatchObject({
				status: "complete",
				segments: [{ text: "Ship Monday" }],
			});
			expect(
				f.requests.filter((r) => r.url.endsWith("/transcription")),
			).toHaveLength(2);
		}),
);

it.scoped(
	"retranscribes completed OpenAI speech on an explicit replacement attempt",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			let connections = 0;
			const socket: typeof SpeechWebSocket.Service = {
				connect: () =>
					fakeSocket(++connections === 1 ? "Ship Friday" : "Ship Monday").pipe(
						Effect.map((s) => s.socket),
					),
			};
			const adapter = yield* makeLiveMeetingAdapter({ ...f, socket });
			const request = {
				...f.request,
				config: {
					...f.request.config,
					asrProvider: "openai" as const,
					asrModel: "gpt-realtime-mini",
				},
			};
			for (let attempt = 0; attempt < 2; attempt++) {
				const job = yield* adapter.submit(request).pipe(Effect.fork);
				yield* TestClock.adjust(700);
				yield* Fiber.join(job);
			}
			expect(connections).toBe(2);
			expect(f.states.get("meeting")?.segments).toMatchObject([
				{ text: "Ship Monday" },
			]);
			expect(f.released()).toBe(2);
		}),
);

it.scoped(
	"budgets four-hour file pacing within the production transcription deadline",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const queue = yield* Queue.unbounded<unknown>();
			let frames = 0;
			const durationMs = 4 * 3600000;
			const frameCount = 24;
			let firstAppend = 0;
			let eofAt = 0;
			const socket: typeof SpeechWebSocket.Service = {
				connect: () =>
					Effect.succeed({
						send: (raw) =>
							Effect.gen(function* () {
								const event = object(JSON.parse(String(raw)));
								if (event.type === "input_audio_buffer.append") {
									if (!frames) firstAppend = yield* Clock.currentTimeMillis;
									frames++;
								}
								if (event.type === "session.update")
									yield* Queue.offer(queue, { type: "session.updated" });
								if (event.type === "input_audio_buffer.commit") {
									eofAt = yield* Clock.currentTimeMillis;
								}
								if (event.type === "input_audio_buffer.commit")
									yield* Queue.offerAll(queue, [
										{ type: "input_audio_buffer.committed", item_id: "file" },
										{
											type: "conversation.item.input_audio_transcription.completed",
											item_id: "file",
											transcript: "complete four hour file",
										},
									]);
							}),
						receive: Queue.take(queue),
						close: Effect.void,
					}),
			};
			const frame = new Uint8Array(30720);
			const resources: MeetingResources = {
				...f.resources,
				pcm: () =>
					Effect.succeed({
						frames: Stream.range(1, frameCount).pipe(Stream.map(() => frame)),
						release: Effect.void,
					}),
			};
			const adapter = yield* makeLiveMeetingAdapter({
				...f,
				resources,
				socket,
			});
			const config = {
				...f.request.config,
				asrProvider: "openai" as const,
				asrModel: "gpt-realtime-mini",
			};
			const job = yield* transcribeMeeting(
				Option.some(adapter),
				config,
				"meeting",
				durationMs,
			).pipe(Effect.either, Effect.fork);
			yield* TestClock.adjust(4000);
			const result = yield* Fiber.join(job);
			expect(Either.isRight(result)).toBe(true);
			expect(frames).toBe(frameCount);
			const projectedUploadMs =
				((eofAt - firstAppend) / frames) * (durationMs / 640);
			expect(projectedUploadMs).toBeGreaterThan(0);
			expect(projectedUploadMs + 30000).toBeLessThan(1800000);
		}),
	{ timeout: 30000 },
);

it.effect(
	"deletes an accepted transcript when ownership persistence fails",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			f.states.set("meeting", {
				version: 1,
				config: f.request.config,
				remoteFiles: [],
				cleanupPending: false,
			});
			const failure = meetingError("StorageFailed", new Error("disk full"));
			const resources: MeetingResources = {
				...f.resources,
				save: () => Effect.fail(failure),
			};
			const files = meetingFileHygiene(f.http, resources, f.resolve);
			const result = yield* Effect.either(
				files.upload("meeting", "private transcript"),
			);
			expect(Either.isLeft(result) && result.left).toBe(failure);
			expect(
				f.requests.filter((r) => r.init.method === "DELETE").map((r) => r.url),
			).toEqual(["http://127.0.0.1:1234/api/v1/files/owned-file"]);
		}),
);

it.effect(
	"finishes transcript ownership handoff before honoring interruption",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			f.states.set("meeting", {
				version: 1,
				config: f.request.config,
				remoteFiles: [],
				cleanupPending: false,
			});
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const resources: MeetingResources = {
				...f.resources,
				save: (ref, state) =>
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Deferred.await(release)),
						Effect.zipRight(f.resources.save(ref, state)),
					),
			};
			const files = meetingFileHygiene(f.http, resources, f.resolve);
			const job = yield* files
				.upload("meeting", "private transcript")
				.pipe(Effect.fork);
			yield* Deferred.await(entered);
			yield* Fiber.interruptFork(job);
			yield* Effect.yieldNow();
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.await(job);
			expect(f.states.get("meeting")?.remoteFiles).toEqual(["owned-file"]);
		}),
);

it.scoped(
	"discards undelivered translation text when its socket disconnects",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const s = yield* fakeSocket();
			const live = yield* makeMeetingTranslation(s.transport, f.resolve);
			yield* live.prepareTranslation(f.request.config);
			yield* Queue.offer(s.queue, {
				type: "response.text.delta",
				response_id: "old",
				delta: "stale paragraph",
			});
			yield* Effect.yieldNow();
			yield* Queue.offer(s.queue, "disconnect");
			yield* Effect.yieldNow();
			const reconnect = yield* live
				.translate(f.request.config, new Uint8Array(14400))
				.pipe(Effect.fork);
			yield* TestClock.adjust(500);
			expect(yield* Fiber.join(reconnect)).toEqual([]);
			yield* Queue.offer(s.queue, {
				type: "response.text.done",
				response_id: "new",
				text: "fresh paragraph",
			});
			yield* Effect.yieldNow();
			expect(
				yield* live.translate(f.request.config, new Uint8Array(14400)),
			).toMatchObject([{ id: "1:new", text: "fresh paragraph" }]);
		}),
);

it.scoped(
	"continues owned file cleanup when DashScope rejects cancellation",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			f.states.set("meeting", {
				version: 1,
				config: f.request.config,
				task: "running-task",
				remoteFiles: ["owned-file"],
				cleanupPending: true,
			});
			const s = yield* fakeSocket();
			const adapter = yield* makeLiveMeetingAdapter({
				...f,
				socket: s.transport,
				http: {
					fetch: async (url, init) =>
						url.endsWith("/cancel")
							? Response.json({ code: "UnsupportedOperation" }, { status: 400 })
							: f.http.fetch(url, init),
				},
			});
			yield* adapter.cleanup?.("meeting");
			expect(
				f.requests.filter((r) => r.init.method === "DELETE").map((r) => r.url),
			).toEqual(["http://127.0.0.1:1234/api/v1/files/owned-file"]);
			expect(f.states.get("meeting")).toMatchObject({
				task: undefined,
				remoteFiles: [],
				cleanupPending: false,
			});
		}),
);

it.scoped("omits output language from OpenAI source transcription hints", () =>
	Effect.gen(function* () {
		const f = fixture();
		const s = yield* fakeSocket();
		const adapter = yield* makeLiveMeetingAdapter({
			...f,
			socket: s.transport,
		});
		const task = yield* adapter
			.submit({
				...f.request,
				config: {
					...f.request.config,
					asrProvider: "openai",
					asrModel: "gpt-realtime-mini",
					outputLanguage: "yue",
				},
			})
			.pipe(Effect.fork);
		yield* TestClock.adjust(700);
		yield* Fiber.join(task);
		const audio = object(object(s.events[0]?.session).audio);
		expect(object(object(audio.input).transcription)).toEqual({
			model: "gpt-4o-transcribe",
		});
	}),
);

it.scoped(
	"keeps source recognition out of translations and links speaker identity",
	() =>
		Effect.gen(function* () {
			const f = fixture();
			const s = yield* fakeSocket();
			const live = yield* makeMeetingTranslation(s.transport, f.resolve);
			yield* live.prepareTranslation(f.request.config);
			for (const event of [
				{
					type: "input_audio_buffer.speech_started",
					item_id: "source",
					speaker_id: 2,
				},
				{
					type: "conversation.item.input_audio_transcription.text",
					item_id: "source",
					text: "Guten Morgen",
				},
				{
					type: "conversation.item.input_audio_transcription.completed",
					item_id: "source",
					transcript: "Guten Morgen",
				},
				{
					type: "conversation.item.created",
					previous_item_id: "source",
					item: { id: "translated" },
				},
				{ type: "response.text.delta", item_id: "translated", delta: "Good " },
				{
					type: "response.text.done",
					item_id: "translated",
					text: "Good morning",
				},
			])
				yield* Queue.offer(s.queue, event);
			yield* Effect.yieldNow();
			expect(
				yield* live.translate(f.request.config, new Uint8Array(14400)),
			).toMatchObject([
				{ id: "0:translated", text: "Good morning", speaker: "2", final: true },
			]);
		}),
);

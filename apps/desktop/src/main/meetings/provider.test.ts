import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Queue,
	Redacted,
} from "effect";
import { expect, it, vi } from "vitest";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { object } from "../../../../../packages/edge/src/ai/speech/speech-session";
import { MeetingProvider } from "../../../../../packages/edge/src/meetings/meeting-provider";
import { CredentialVault, MacOsKeychain } from "../credentials/keychain";
import { connectSpeechSocket } from "../speech/websocket";
import { meetingDirectory } from "./private-files";
import { liveMeetingProviders } from "./provider";

vi.mock("electron", () => ({ net: { isOnline: () => true } }));

for (const blockedSend of [false, true]) {
	it(`removing the saved OpenAI credential cancels active transcription, blocked send=${blockedSend}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "oq-revoked-meeting-"));
		const id = "00000000-0000-4000-8000-000000000222";
		try {
			const directory = await meetingDirectory(root, id);
			await new Promise<void>((resolve, reject) => {
				const child = spawn(
					"ffmpeg",
					[
						"-v",
						"error",
						"-f",
						"lavfi",
						"-i",
						"sine=frequency=440:duration=1",
						"-y",
						join(directory, "final_recording.mp3"),
					],
					{ stdio: "ignore" },
				);
				child.once("error", reject);
				child.once("close", (code) =>
					code === 0
						? resolve()
						: reject(new Error("Synthetic encoding failed")),
				);
			});
			const secrets = new Map<string, Redacted.Redacted<string>>();
			const vault = await Effect.runPromise(
				CredentialVault.pipe(
					Effect.provide(
						CredentialVault.Default.pipe(
							Layer.provide(
								Layer.succeed(MacOsKeychain, {
									write: async (_namespace, ref, key) => {
										secrets.set(ref, key);
									},
									read: async (_namespace, ref) =>
										Option.fromNullable(secrets.get(ref)),
									remove: async (_namespace, ref) => {
										secrets.delete(ref);
									},
								}),
							),
						),
					),
				),
			);
			const credential = await Effect.runPromise(
				vault.store(Redacted.make("fake-meeting-secret")),
			);
			const firstAudio = await Effect.runPromise(Deferred.make<void>());
			const queue = await Effect.runPromise(Queue.unbounded<unknown>());
			let appends = 0;
			let closed = 0;
			let signal: AbortSignal | undefined;
			const production = liveMeetingProviders(root, "ffmpeg", {
				models: () =>
					Effect.succeed([
						{
							id: "saved-openai",
							role: "default",
							provider: "openai",
							model: "gpt-5.1",
							baseUrl: "https://api.openai.com/v1",
							maxTokens: 2048,
							credentialRef: credential.reference,
						},
					]),
				credentials: vault,
				socket: {
					connect: (input) =>
						Effect.sync(() => {
							signal = input.signal;
							return {
								send: (raw) =>
									Effect.gen(function* () {
										const event = object(JSON.parse(String(raw)));
										if (event.type === "session.update")
											yield* Queue.offer(queue, { type: "session.updated" });
										if (event.type === "input_audio_buffer.append") {
											appends++;
											yield* Deferred.succeed(firstAudio, undefined);
											if (blockedSend) yield* Effect.never;
										}
									}),
								receive: Queue.take(queue),
								close: Effect.sync(() => {
									closed++;
								}),
							};
						}),
				},
			});
			const config = await Effect.runPromise(production.initialConfig);
			if (!config) throw new Error("Missing saved profile");
			const job = Effect.runFork(
				Effect.scoped(
					MeetingProvider.transcribe(config, id, 1000).pipe(
						Effect.either,
						Effect.provide(production.layer),
					),
				),
			);
			try {
				await Effect.runPromise(
					Deferred.await(firstAudio).pipe(Effect.timeout(2000)),
				);
				await Effect.runPromise(vault.remove(credential.reference));
				const finished = await Effect.runPromise(
					Fiber.join(job).pipe(Effect.timeoutOption(1000)),
				);
				expect(Option.isSome(finished)).toBe(true);
				if (Option.isNone(finished))
					throw new Error("Transcription survived credential removal");
				expect(Either.isLeft(finished.value) && finished.value.left.code).toBe(
					"QUAKE.MEETING.UNAVAILABLE",
				);
				expect(appends).toBe(1);
				expect(closed).toBe(1);
				expect(signal?.aborted).toBe(true);
				expect(secrets.size).toBe(0);
				expect(
					(await readdir(directory)).filter((name) =>
						/^(?:provider-|MM_)/.test(name),
					),
				).toEqual([]);
			} finally {
				await Effect.runPromise(Fiber.interrupt(job));
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

const documentedQwenHosts = [
	"dashscope.aliyuncs.com",
	"dashscope-intl.aliyuncs.com",
	"dashscope.cn-beijing.maas.aliyuncs.com",
	"dashscope.ap-southeast-1.maas.aliyuncs.com",
	"workspace-123.cn-beijing.maas.aliyuncs.com",
	"123456.ap-southeast-1.maas.aliyuncs.com",
];
const rejectedQwenHosts = [
	"10.1.2.3",
	"172.16.0.1",
	"192.168.1.1",
	"169.254.169.254",
	"metadata.google.internal",
	"attacker.example",
	"dashscope.aliyuncs.com.attacker.example",
	"workspace.cn-beijing.maas.aliyuncs.com.attacker.example",
	"workspace.eu-central-1.maas.aliyuncs.com",
	"dashscope-us.aliyuncs.com",
	"a.b.cn-beijing.maas.aliyuncs.com",
	"-workspace.cn-beijing.maas.aliyuncs.com",
	"workspace-.cn-beijing.maas.aliyuncs.com",
	"work_space.cn-beijing.maas.aliyuncs.com",
	`${"a".repeat(64)}.cn-beijing.maas.aliyuncs.com`,
	"dashscope.aliyuncs.com:444",
];
for (const host of [...documentedQwenHosts, ...rejectedQwenHosts]) {
	it(`saved Qwen endpoint policy ${host}`, async () => {
		const root = await mkdtemp(join(tmpdir(), "oq-provider-host-"));
		const connections: string[] = [];
		const http = vi.fn<typeof fetch>();
		try {
			const events = await Effect.runPromise(Queue.unbounded<unknown>());
			const production = liveMeetingProviders(root, "ffmpeg", {
				models: () =>
					Effect.succeed([
						{
							id: "saved-qwen",
							role: "default",
							provider: "qwen",
							model: "qwen3.6-flash",
							baseUrl: `https://${host}/compatible-mode/v1`,
							maxTokens: 2048,
							credentialRef: "00000000-0000-4000-8000-000000000002",
						},
					]),
				credentials: {
					resolve: () => Effect.succeed(Redacted.make("fake-key")),
					revoked: () => Effect.never,
				},
				fetch: http,
				socket: {
					connect: (input) =>
						Effect.sync(() => {
							connections.push(input.url);
							return {
								send: () =>
									Queue.offer(events, { type: "session.updated" }).pipe(
										Effect.asVoid,
									),
								receive: Queue.take(events),
								close: Effect.void,
							};
						}),
				},
			});
			const config = await Effect.runPromise(production.initialConfig);
			if (!config) throw new Error("Missing saved Qwen profile");
			const result = await Effect.runPromise(
				Effect.scoped(
					MeetingProvider.requireTranslation(config).pipe(
						Effect.either,
						Effect.provide(production.layer),
					),
				),
			);
			if (documentedQwenHosts.includes(host)) {
				expect(Either.isRight(result)).toBe(true);
				expect(connections).toEqual([
					`wss://${host}/api-ws/v1/realtime?model=qwen3.5-livetranslate-flash-realtime`,
				]);
			} else {
				expect(Either.isLeft(result)).toBe(true);
				expect(connections).toEqual([]);
			}
			expect(http).not.toHaveBeenCalled();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}

it("composes saved model credentials through the production facade and submits real mono bytes to a local fake provider", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-provider-"));
	const id = "00000000-0000-4000-8000-000000000111";
	let base = "";
	let uploads = 0;
	const requests: { path: string; auth: string | undefined; body: Buffer }[] =
		[];
	const server = createServer(async (req, res) => {
		const parts: Buffer[] = [];
		for await (const chunk of req) parts.push(Buffer.from(chunk));
		const body = Buffer.concat(parts);
		const path = req.url ?? "";
		requests.push({ path, auth: req.headers.authorization, body });
		res.setHeader("content-type", "application/json");
		if (path.startsWith("/api/v1/uploads?"))
			res.end(
				JSON.stringify({
					data: {
						upload_host: `${base}/oss`,
						upload_dir: "meeting-private",
						oss_access_key_id: "fake-oss",
						signature: "fake-signature",
						policy: "fake-policy",
					},
				}),
			);
		else if (path === "/oss") {
			uploads++;
			res.end("{}");
		} else if (path === "/api/v1/services/audio/asr/transcription")
			res.end(
				JSON.stringify({
					output: { task_id: "task-local", task_status: "PENDING" },
				}),
			);
		else if (path === "/api/v1/tasks/task-local")
			res.end(
				JSON.stringify({
					output: {
						task_id: "task-local",
						task_status: "SUCCEEDED",
						results: [
							{
								subtask_status: "SUCCEEDED",
								transcription_url: `${base}/transcript`,
							},
						],
					},
				}),
			);
		else if (path === "/compatible-mode/v1/chat/completions") {
			res.setHeader("content-type", "text/event-stream");
			for (const data of [
				{
					choices: [
						{
							index: 0,
							delta: { content: "## Summary from saved profile" },
							finish_reason: null,
						},
					],
				},
				{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
				"[DONE]",
			])
				res.write(
					`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`,
				);
			res.end();
		} else if (path === "/transcript")
			res.end(
				JSON.stringify({
					transcripts: [
						{
							sentences: [
								{
									speaker_id: 1,
									begin_time: 0,
									end_time: 300,
									text: "Grüße from the fake provider",
								},
							],
						},
					],
				}),
			);
		else {
			res.statusCode = 404;
			res.end("{}");
		}
	});
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("No address");
		base = `http://127.0.0.1:${address.port}`;
		const directory = await meetingDirectory(root, id);
		await new Promise<void>((resolve, reject) => {
			const p = spawn(
				"ffmpeg",
				[
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:duration=0.3",
					"-ac",
					"2",
					"-y",
					join(directory, "final_recording.mp3"),
				],
				{ stdio: "ignore" },
			);
			p.once("error", reject);
			p.once("close", (code) =>
				code === 0 ? resolve() : reject(new Error("Fixture FFmpeg failed")),
			);
		});
		const row: ModelRow = {
			id: "saved-qwen",
			role: "default",
			provider: "qwen",
			model: "qwen3.6-flash",
			baseUrl: `${base}/compatible-mode/v1`,
			maxTokens: 2048,
			credentialRef: "00000000-0000-4000-8000-000000000002",
		};
		const resolve = vi.fn(() =>
			Effect.succeed(Redacted.make("fixture-vault-key")),
		);
		const options = {
			models: () => Effect.succeed([row]),
			credentials: { resolve, revoked: () => Effect.never },
		};
		const production = liveMeetingProviders(root, "ffmpeg", options);
		const config = await Effect.runPromise(production.initialConfig);
		if (!config) throw new Error("Missing initial saved config");
		expect(config).toMatchObject({
			asrProvider: "dashscope",
			minutesModel: "qwen3.6-flash",
		});
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const provider = yield* MeetingProvider;
					const transcript = yield* provider.transcribe(config, id, 300);
					expect(transcript).toMatchObject([
						{ speaker: "1", text: "Grüße from the fake provider" },
					]);
					expect(
						yield* provider.summarize(config, transcript, "interview"),
					).toBe("## Summary from saved profile");
				}).pipe(Effect.provide(production.layer)),
			),
		);
		expect(
			requests.find((r) => r.path.endsWith("/chat/completions"))?.auth,
		).toBe("Bearer fixture-vault-key");
		expect(
			requests
				.find((r) => r.path.endsWith("/chat/completions"))
				?.body.toString(),
		).toContain("Grüße from the fake provider");
		expect(resolve).toHaveBeenCalled();
		expect(uploads).toBe(1);
		expect(requests.find((r) => r.path === "/oss")?.auth).toBeUndefined();
		expect(
			requests.find((r) => r.path.startsWith("/api/v1/uploads"))?.auth,
		).toBe("Bearer fixture-vault-key");
		const upload = requests.find((r) => r.path === "/oss")?.body;
		if (!upload) throw new Error("No upload");
		const start =
			upload.indexOf(Buffer.from("Content-Type: audio/mpeg\r\n\r\n")) +
			Buffer.byteLength("Content-Type: audio/mpeg\r\n\r\n");
		const end = upload.indexOf(Buffer.from("\r\n--"), start);
		const mp3 = upload.subarray(start, end);
		expect(mp3.length).toBeGreaterThan(100);
		const mono = join(directory, "inspect-upload.mp3");
		await import("node:fs/promises").then(({ writeFile }) =>
			writeFile(mono, mp3),
		);
		let channels = "";
		await new Promise<void>((resolve, reject) => {
			const p = spawn("ffprobe", [
				"-v",
				"error",
				"-select_streams",
				"a:0",
				"-show_entries",
				"stream=channels",
				"-of",
				"csv=p=0",
				mono,
			]);
			p.stdout.on("data", (b: Buffer) => {
				channels += b.toString();
			});
			p.once("error", reject);
			p.once("close", (c) =>
				c === 0 ? resolve() : reject(new Error("Invalid uploaded audio")),
			);
		});
		expect(channels.trim()).toBe("1");
		expect(
			(await readdir(directory)).some(
				(name) => name.startsWith("provider-") && name.endsWith(".mp3"),
			),
		).toBe(false);
		for (const name of [
			"provider-state.json",
			"MM_Transcription.txt",
			"MM_Transcription.txtoriginal.json",
		])
			expect((await stat(join(directory, name))).mode & 0o777).toBe(0o600);
		expect(
			await readFile(join(directory, "MM_Transcription.txt"), "utf8"),
		).toContain("Grüße");
		const restarted = liveMeetingProviders(root, "ffmpeg", options);
		await Effect.runPromise(
			Effect.scoped(
				MeetingProvider.transcribe(config, id, 300).pipe(
					Effect.provide(restarted.layer),
				),
			),
		);
		expect(uploads).toBe(1);
		const { meetingResources } = await import("./provider-resources");
		await import("node:fs/promises").then(({ writeFile }) =>
			writeFile(join(directory, "final_recording.mp3"), "invalid codec"),
		);
		const bad = await Effect.runPromise(
			Effect.either(meetingResources(root, "ffmpeg").audio(id)),
		);
		expect(Either.isLeft(bad)).toBe(true);
		expect(
			(await readdir(directory)).filter((name) =>
				/^provider-.*\.(mp3|pcm)$/.test(name),
			),
		).toEqual([]);
		const { meetingStorage } = await import("./storage");
		await Effect.runPromise(
			meetingStorage(root).remove({ version: 1, records: [] }, [id]),
		);
		expect(await readdir(root)).not.toContain(id);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
});

it("AI-288 mixes unequal tracks, skips empty/corrupt optional system files and joins numeric segment order", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meeting-mix-"));
	try {
		const id = "00000000-0000-4000-8000-000000000112";
		const directory = await meetingDirectory(root, id);
		const encode = async (name: string, duration: number) =>
			new Promise<void>((resolve, reject) => {
				const p = spawn(
					"ffmpeg",
					[
						"-v",
						"error",
						"-f",
						"lavfi",
						"-i",
						`sine=frequency=440:duration=${duration}`,
						"-c:a",
						"libopus",
						"-y",
						join(directory, name),
					],
					{ stdio: "ignore" },
				);
				p.once("error", reject);
				p.once("close", (c) =>
					c === 0 ? resolve() : reject(new Error("Could not encode fixture")),
				);
			});
		await encode("mic_2.webm", 0.1);
		await encode("system_2.webm", 0.4);
		await encode("mic_10.webm", 0.1);
		await encode("mic_11.webm", 0.1);
		const { writeFile } = await import("node:fs/promises");
		await writeFile(join(directory, "system_10.webm"), "");
		await writeFile(join(directory, "system_11.webm"), "not a codec");
		const { audioFiles } = await import("./audio-files");
		await Effect.runPromise(audioFiles(root, "ffmpeg").finalize(id));
		expect(await readFile(join(directory, "filelist.txt"), "utf8")).toBe(
			"file 'merged_2.mp3'\nfile 'merged_10.mp3'\nfile 'merged_11.mp3'",
		);
		const elapsed = await Effect.runPromise(
			audioFiles(root, "ffmpeg").duration(id),
		);
		expect(elapsed).toBeGreaterThan(590);
		expect(elapsed).toBeLessThan(800);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("AI-269 AI-272 sends synthetic file PCM through production saved-profile composition and a real loopback WebSocket", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-openai-meeting-ws-"));
	const id = "00000000-0000-4000-8000-000000000113";
	const sockets = new Set<Duplex>();
	const events: Record<string, unknown>[] = [];
	let auth: string | undefined;
	let model: string | null = null;
	const server = createServer();
	server.on("upgrade", (request, socket) => {
		auth = request.headers.authorization;
		model = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get(
			"model",
		);
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		const accept = createHash("sha1")
			.update(
				`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
			)
			.digest("base64");
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		const send = (event: object) => {
			const bytes = Buffer.from(JSON.stringify(event));
			const header = Buffer.alloc(bytes.length < 126 ? 2 : 4);
			header[0] = 0x81;
			header[1] = bytes.length < 126 ? bytes.length : 126;
			if (bytes.length >= 126) header.writeUInt16BE(bytes.length, 2);
			socket.write(Buffer.concat([header, bytes]));
		};
		let buffered: Buffer = Buffer.alloc(0);
		socket.on("data", (data: Buffer) => {
			buffered = Buffer.concat([buffered, data]);
			while (buffered.length >= 2) {
				let size = (buffered[1] ?? 0) & 127;
				let header = 2;
				if (size === 126) {
					if (buffered.length < 4) return;
					size = buffered.readUInt16BE(2);
					header = 4;
				}
				if (size === 127) {
					socket.destroy();
					return;
				}
				if (buffered.length < header + 4 + size) return;
				const mask = buffered.subarray(header, header + 4);
				const payload = Buffer.from(
					buffered.subarray(header + 4, header + 4 + size),
				);
				const opcode = (buffered[0] ?? 0) & 15;
				buffered = buffered.subarray(header + 4 + size);
				if (opcode !== 1) continue;
				for (let i = 0; i < payload.length; i++)
					payload[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
				const raw: unknown = JSON.parse(payload.toString());
				if (typeof raw !== "object" || raw === null) {
					socket.destroy();
					return;
				}
				const event = Object.fromEntries(Object.entries(raw));
				events.push(event);
				if (event.type === "session.update") send({ type: "session.updated" });
				if (event.type === "input_audio_buffer.commit") {
					send({
						type: "input_audio_buffer.speech_started",
						item_id: "utterance",
						audio_start_ms: 0,
					});
					send({
						type: "input_audio_buffer.speech_stopped",
						item_id: "utterance",
						audio_end_ms: 300,
					});
					send({ type: "input_audio_buffer.committed", item_id: "utterance" });
					send({
						type: "conversation.item.input_audio_transcription.completed",
						item_id: "utterance",
						transcript: "local websocket transcript",
					});
				}
			}
		});
	});
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("No fixture port");
		const directory = await meetingDirectory(root, id);
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				"ffmpeg",
				[
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:duration=0.3",
					"-ac",
					"2",
					"-y",
					join(directory, "final_recording.mp3"),
				],
				{ stdio: "ignore" },
			);
			child.once("error", reject);
			child.once("close", (code) =>
				code === 0
					? resolve()
					: reject(new Error("Synthetic audio encoding failed")),
			);
		});
		const production = liveMeetingProviders(root, "ffmpeg", {
			models: () =>
				Effect.succeed([
					{
						id: "saved-openai",
						role: "default",
						provider: "openai",
						model: "gpt-5.1",
						baseUrl: `http://127.0.0.1:${address.port}/v1`,
						maxTokens: 2048,
						credentialRef: "00000000-0000-4000-8000-000000000002",
					},
				]),
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("fake-openai-vault-key")),
				revoked: () => Effect.never,
			},
			socket: { connect: (input) => connectSpeechSocket(input, true) },
		});
		const config = await Effect.runPromise(production.initialConfig);
		if (!config) throw new Error("Missing saved OpenAI config");
		const transcript = await Effect.runPromise(
			Effect.scoped(
				MeetingProvider.transcribe(config, id, 300).pipe(
					Effect.provide(production.layer),
				),
			),
		);
		expect(transcript).toMatchObject([
			{ startMs: 0, endMs: 300, text: "local websocket transcript" },
		]);
		expect(auth).toBe("Bearer fake-openai-vault-key");
		expect(model).toBe("gpt-realtime-mini");
		const audio = events.filter((e) => e.type === "input_audio_buffer.append");
		expect(audio.length).toBeGreaterThan(0);
		for (const event of audio) {
			if (typeof event.audio !== "string")
				throw new Error("Missing audio data");
			expect(Buffer.from(event.audio, "base64").length).toBeLessThanOrEqual(
				30720,
			);
		}
		expect(
			(await readdir(directory)).filter((name) => name.endsWith(".pcm")),
		).toEqual([]);
		expect(
			await readFile(join(directory, "MM_Transcription.txt"), "utf8"),
		).toContain("local websocket transcript");
	} finally {
		for (const socket of sockets) socket.destroy();
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	}
});

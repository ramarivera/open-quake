import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Redacted } from "effect";
import { expect, it, vi } from "vitest";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { MeetingProvider } from "../../../../../packages/edge/src/meetings/meeting-provider";
import { meetingDirectory } from "./private-files";
import { liveMeetingProviders } from "./provider";

vi.mock("electron", () => ({ net: { isOnline: () => true } }));

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
		else if (path === "/transcript")
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
					expect(yield* provider.transcribe(config, id, 300)).toMatchObject([
						{ speaker: "1", text: "Grüße from the fake provider" },
					]);
				}).pipe(Effect.provide(production.layer)),
			),
		);
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

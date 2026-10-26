import { createServer } from "node:http";
import { Effect, Redacted, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { ChatInference } from "../../../../../packages/edge/src/chat/chat-ports";
import { decodeGif } from "../../shared/gif";
import { tinyFixture } from "../../shared/gif/fixtures";
import { createEmojiGeneration, validateCaptionSuggestion } from "./generation";

vi.mock("electron", () => ({ BrowserWindow: class {} }));
const row: ModelRow = {
	id: "saved",
	role: "default",
	provider: "qwen",
	model: "qwen-plus",
	baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
	maxTokens: 4096,
	credentialRef: "00000000-0000-4000-8000-000000000001",
};
const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of closes.splice(0)) await close();
});
async function fixture(
	mode: "success" | "failure" | "create-failure" | "pending" = "success",
	deadlineMs = 1000,
) {
	const requests: { path: string; auth: string | undefined; body: string }[] =
		[];
	let polls = 0;
	const server = createServer(async (req, res) => {
		let body = "";
		for await (const chunk of req) body += chunk;
		requests.push({
			path: req.url ?? "",
			auth: req.headers.authorization,
			body,
		});
		if (req.url === "/asset") {
			res.end("synthetic-video");
			return;
		}
		res.setHeader("Content-Type", "application/json");
		if (req.url?.includes("video-synthesis")) {
			if (mode === "create-failure") {
				res.statusCode = 401;
				res.end('{"private":"secret-provider-body"}');
			} else
				res.end(
					JSON.stringify({
						output: { task_id: "task-1", task_status: "PENDING" },
					}),
				);
			return;
		}
		polls++;
		res.end(
			JSON.stringify({
				output: {
					task_status:
						mode === "failure"
							? "FAILED"
							: mode === "pending" || polls === 1
								? "RUNNING"
								: "SUCCEEDED",
					video_url: `http://127.0.0.1:${port}/asset`,
				},
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	closes.push(
		() =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	);
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No server address");
	const port = address.port;
	const decode = vi.fn(async (bytes: Uint8Array, signal: AbortSignal) => {
		signal.throwIfAborted();
		expect(Buffer.from(bytes).toString()).toBe("synthetic-video");
		return Buffer.from(tinyFixture, "base64");
	});
	const adapter = createEmojiGeneration({
		models: async () => [row],
		credentials: {
			resolve: () => Effect.succeed(Redacted.make("private-key")),
			revoked: () => Effect.never,
		},
		infer: () => Promise.resolve(""),
		endpoint: `http://127.0.0.1:${port}/api/v1/`,
		pollMs: 1,
		deadlineMs,
		decode,
	});
	return { adapter, requests, decode };
}
const input = {
	bytes: new Uint8Array([1, 2, 3]),
	format: "image/png" as const,
	prompt: "Wave",
};
describe("direct BYO-key emoji generation", () => {
	it("creates, polls, downloads without credential forwarding and returns a GIF", async () => {
		const f = await fixture();
		const gif = await f.adapter.generate(input);
		expect(decodeGif(gif).frames).toHaveLength(1);
		expect(f.requests.map((r) => r.path)).toEqual([
			"/api/v1/services/aigc/video-generation/video-synthesis",
			"/api/v1/tasks/task-1",
			"/api/v1/tasks/task-1",
			"/asset",
		]);
		expect(JSON.parse(f.requests[0]?.body ?? "")).toMatchObject({
			model: "wan2.2-i2v-flash",
			input: { prompt: "Wave", img_url: "data:image/png;base64,AQID" },
			parameters: {
				resolution: "480P",
				duration: 5,
				prompt_extend: true,
				watermark: false,
			},
		});
		expect(
			f.requests.slice(0, -1).every((r) => r.auth === "Bearer private-key"),
		).toBe(true);
		expect(f.requests.at(-1)?.auth).toBeUndefined();
		expect(f.decode).toHaveBeenCalledOnce();
	});
	it.each(["failure", "create-failure"] as const)(
		"reports %s without leaking credentials or response bodies",
		async (mode) => {
			const f = await fixture(mode);
			const error = await f.adapter
				.generate(input)
				.catch((error: unknown) => error);
			expect(JSON.stringify(error)).not.toMatch(
				/private-key|secret-provider-body/,
			);
			expect(f.decode).not.toHaveBeenCalled();
			expect(error).toMatchObject({ _tag: "EmojiInvalid" });
		},
	);
	it("aborts polling at its deadline", async () => {
		const f = await fixture("pending", 20);
		await expect(f.adapter.generate(input)).rejects.toBeDefined();
		expect(f.decode).not.toHaveBeenCalled();
	});
	it("aborts on caller cancellation", async () => {
		const f = await fixture("pending");
		const cancel = new AbortController();
		const operation = f.adapter.generate({ ...input, signal: cancel.signal });
		cancel.abort();
		await expect(operation).rejects.toBeDefined();
		expect(f.decode).not.toHaveBeenCalled();
	});
});
it.each([
	["zh", "Chinese"],
	["en", "English"],
	["ja", "Japanese"],
	["ko", "Korean"],
	["de", "German"],
	["fr", "French"],
	["es", "Spanish"],
	["it", "Italian"],
])(
	"suggests in %s with a ten-character bound without writing anything",
	async (locale, language) => {
		let system = "";
		let cancelled = false;
		const adapter = createEmojiGeneration({
			models: async () => [row],
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("private")),
				revoked: () => Effect.never,
			},
			infer: (effect, signal) =>
				Effect.runPromise(
					effect.pipe(
						Effect.provideService(ChatInference, {
							open: (_profile, request) => {
								system =
									request.messages[0]?.content[0]?._tag === "text"
										? request.messages[0].content[0].text
										: "";
								expect(request).toMatchObject({
									modelRole: "daily",
									controls: { thinking: false },
									sampling: { temperature: 0.1, maxOutputTokens: 2048 },
								});
								return Effect.succeed({
									events: Stream.make({
										_tag: "textDelta" as const,
										textDelta: "🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂",
										kind: "generation" as const,
									}),
									cancel: () =>
										Effect.sync(() => {
											cancelled = true;
										}),
								});
							},
						}),
					),
					{ signal },
				),
		});
		expect(
			await adapter.suggest?.(
				"Keep entered text",
				locale ?? "en",
				new AbortController().signal,
			),
		).toBe("🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂");
		expect(system).toContain(language);
		expect(cancelled).toBe(true);
		expect(() => validateCaptionSuggestion("🙂".repeat(11))).toThrow();
	},
);

import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";
import { tinyFixture } from "../../shared/gif/fixtures";
import { createEmojiGeneration } from "./generation";
import type { MediaRequest } from "./media-download";

vi.mock("electron", () => ({ BrowserWindow: class {} }));
const origin = "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com";
function fixture(url: string, addresses = ["8.8.8.8"], status = 200, size = 1) {
	const lookup = vi.fn(async () =>
		addresses.map((address) => ({
			address,
			family: address.includes(":") ? 6 : 4,
		})),
	);
	const connected: string[] = [];
	const mediaRequest: MediaRequest = (url, options, respond) => {
		let failed: (cause: Error) => void = () => {};
		return {
			once: (_event, listener) => {
				failed = listener;
			},
			end: () => {
				options.lookup?.(url.hostname, {}, (error, address) => {
					if (error) {
						failed(error);
						return;
					}
					connected.push(
						typeof address === "string" ? address : (address[0]?.address ?? ""),
					);
					const response = new IncomingMessage(new Socket());
					response.statusCode = status;
					response.headers = {
						location: "https://169.254.169.254/latest/meta-data/",
					};
					respond(response);
					response.push(Buffer.alloc(size));
					response.push(null);
				});
			},
		};
	};
	const fetch = vi.fn(async () =>
		Response.json({
			output: { task_id: "task-1", task_status: "SUCCEEDED", video_url: url },
		}),
	);
	const decode = vi.fn(async () => Buffer.from(tinyFixture, "base64"));
	const adapter = createEmojiGeneration({
		models: async () => [
			{
				id: "saved",
				role: "default",
				provider: "qwen",
				model: "qwen-plus",
				baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				maxTokens: 4096,
				credentialRef: "00000000-0000-4000-8000-000000000001",
			},
		],
		credentials: {
			resolve: () => Effect.succeed(Redacted.make("private-key")),
			revoked: () => Effect.never,
		},
		infer: async () => "",
		fetch,
		decode,
		mediaRequest,
		mediaLookup: lookup,
	});
	return { adapter, fetch, decode, connected, lookup };
}
const input = {
	bytes: new Uint8Array([1]),
	format: "image/png" as const,
	prompt: "Wave",
};
describe("provider media network boundary", () => {
	it.each([
		"https://127.0.0.1/x",
		"https://10.0.0.1/x",
		"https://169.254.169.254/x",
		"https://[::1]/x",
		"http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x",
		"https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.test/x",
		`${origin}:444/x`,
		`https://user:password@${new URL(origin).hostname}/x`,
	])("refuses unapproved URL %s before opening media", async (url) => {
		const f = fixture(url);
		await expect(f.adapter.generate(input)).rejects.toMatchObject({
			_tag: "EmojiInvalid",
		});
		expect(f.fetch).toHaveBeenCalledTimes(1);
		expect(f.connected).toEqual([]);
		expect(f.decode).not.toHaveBeenCalled();
	});
	it.each([
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.100.100.200",
		"::1",
		"fc00::1",
		"fe80::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"2001:db8::1",
	])("refuses approved hostname resolving to %s", async (address) => {
		const f = fixture(`${origin}/x`, [address]);
		await expect(f.adapter.generate(input)).rejects.toBeDefined();
		expect(f.connected).toEqual([]);
		expect(f.decode).not.toHaveBeenCalled();
	});
	it("rejects mixed public/private answers instead of selecting a private fallback", async () => {
		const f = fixture(`${origin}/x`, ["8.8.8.8", "10.0.0.1"]);
		await expect(f.adapter.generate(input)).rejects.toBeDefined();
		expect(f.connected).toEqual([]);
	});
	it("pins a documented origin to the validated public DNS address without forwarding auth", async () => {
		const f = fixture(`${origin}/x?Expires=123`);
		await expect(f.adapter.generate(input)).resolves.toEqual(
			Buffer.from(tinyFixture, "base64"),
		);
		expect(f.connected).toEqual(["8.8.8.8"]);
		expect(f.lookup).toHaveBeenCalledOnce();
		expect(f.fetch).toHaveBeenCalledTimes(1);
		expect(f.decode).toHaveBeenCalledOnce();
	});
	it("never follows a redirect from approved storage to internal metadata", async () => {
		const f = fixture(`${origin}/x`, ["8.8.8.8"], 302);
		await expect(f.adapter.generate(input)).rejects.toMatchObject({
			_tag: "EmojiInvalid",
		});
		expect(f.connected).toEqual(["8.8.8.8"]);
		expect(f.decode).not.toHaveBeenCalled();
	});
	it("bounds streamed video bytes before decoding", async () => {
		const f = fixture(`${origin}/x`, ["8.8.8.8"], 200, 32 * 1024 * 1024 + 1);
		await expect(f.adapter.generate(input)).rejects.toMatchObject({
			_tag: "EmojiInvalid",
		});
		expect(f.decode).not.toHaveBeenCalled();
	});
});

import { describe, expect, it, vi } from "vitest";
import { emptyEmojiStore } from "../../../../../../../packages/edge/src/emoji/emoji-contracts";
import type { EmojiReply, EmojiRequest } from "../../../../shared/emoji";
import { createEmojiAssetCache } from "./asset-cache";

const ready = (hash: string, source: string): EmojiReply => ({
	_tag: "ready",
	store: emptyEmojiStore,
	assets: { [hash]: source },
	apps: [],
	notice: "",
});
describe("emoji on-demand assets", () => {
	it("deduplicates concurrent requests and serves later consumers without IPC", async () => {
		const request = vi.fn(async (_input: EmojiRequest) =>
			ready("one", "data:one"),
		);
		const cache = createEmojiAssetCache(request);
		expect(await Promise.all([cache.load("one"), cache.load("one")])).toEqual([
			"data:one",
			"data:one",
		]);
		expect(await cache.load("one")).toBe("data:one");
		expect(request.mock.calls).toEqual([[{ type: "asset", hash: "one" }]]);
		expect(await cache.load("")).toBe("");
		expect(request).toHaveBeenCalledTimes(1);
	});
	it("evicts least-recently-used data URLs at its memory budget", async () => {
		const request = vi.fn(async (input: EmojiRequest) =>
			ready(input.type === "asset" ? input.hash : "", "1234"),
		);
		const cache = createEmojiAssetCache(request, 16);
		await cache.load("one");
		await cache.load("two");
		await cache.load("one");
		await cache.load("three");
		await cache.load("one");
		expect(request).toHaveBeenCalledTimes(3);
		await cache.load("two");
		expect(request).toHaveBeenCalledTimes(4);
	});
	it("retries failed replies, rejected requests, and does not retain oversized results", async () => {
		const request = vi
			.fn<(_input: EmojiRequest) => Promise<EmojiReply>>()
			.mockRejectedValueOnce(Error("unavailable"))
			.mockResolvedValueOnce({
				_tag: "failure",
				code: "unavailable",
				message: "unavailable",
			})
			.mockResolvedValue(ready("one", "oversized"));
		const cache = createEmojiAssetCache(request, 2);
		await expect(cache.load("one")).rejects.toThrow("unavailable");
		expect(await cache.load("one")).toBe("");
		expect(await cache.load("one")).toBe("oversized");
		await cache.load("one");
		expect(request).toHaveBeenCalledTimes(4);
	});
});

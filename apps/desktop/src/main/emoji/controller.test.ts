import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it, vi } from "vitest";
import { emptyEmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import { EmojiLibrary } from "../../../../../packages/edge/src/emoji/emoji-service";
import { encodeGif } from "../../shared/gif";
import { ImageDecoder } from "../media/image-decoder";
import { type EmojiGenerationPort, makeEmojiController } from "./controller";
import { emojiFiles } from "./files";

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	nativeImage: {},
}));
const gif = (delay = 120) =>
	encodeGif({
		width: 2,
		height: 1,
		loopCount: 0,
		frames: [
			{
				rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
				delayMs: delay,
			},
		],
	});
async function setup(generation?: EmojiGenerationPort) {
	const root = await mkdtemp(join(tmpdir(), "oq-emoji-controller-"));
	const files = emojiFiles(root);
	const hash = await files.put(new Uint8Array([1, 2, 3]));
	await files.write({
		...emptyEmojiStore,
		staticAssets: [{ hash, name: "Source", format: "image/png" }],
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			EmojiLibrary.DefaultWithoutDependencies,
			ImageDecoder.Default,
		).pipe(
			Layer.provideMerge(
				EmojiRepository.Default.pipe(Layer.provide(emojiStorageLayer(files))),
			),
		),
	);
	const controller = await runtime.runPromise(
		makeEmojiController({
			files,
			management: () => {
				throw Error("No picker in this test");
			},
			place: async () => "profile",
			...(generation ? { generation } : {}),
		}),
	);
	return {
		hash,
		files,
		runtime,
		controller,
		close: async () => {
			await runtime.dispose();
			await rm(root, { recursive: true, force: true });
		},
	};
}
describe("emoji desktop controller", () => {
	it("returns explicit unavailable generation and retains the library", async () => {
		const f = await setup();
		try {
			const result = await f.runtime.runPromise(
				Effect.either(
					f.controller.request({
						type: "generate",
						assetId: f.hash,
						prompt: "Wave",
					}),
				),
			);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left")
				expect(result.left.code).toBe("QUAKE.EMOJI.INVALID");
			expect((await f.files.read())?.items).toEqual([]);
		} finally {
			await f.close();
		}
	});
	it("passes the selected asset and prompt to the configured port, validates and persists its GIF", async () => {
		const generate = vi.fn(async () => gif());
		const f = await setup({ generate });
		try {
			const result = await f.runtime.runPromise(
				f.controller.request({
					type: "generate",
					assetId: f.hash,
					prompt: "Wave",
				}),
			);
			expect(result._tag).toBe("ready");
			expect(generate).toHaveBeenCalledWith({
				bytes: Buffer.from([1, 2, 3]),
				format: "image/png",
				prompt: "Wave",
			});
			expect((await f.files.read())?.drafts).toHaveLength(1);
		} finally {
			await f.close();
		}
	});
	it("rejects a caption that changes timing without publishing a new library", async () => {
		const f = await setup();
		try {
			const original = await f.runtime.runPromise(
				f.controller.request({
					type: "create-result",
					name: "Hello",
					base64: Buffer.from(gif()).toString("base64"),
				}),
			);
			if (original._tag !== "ready") throw Error("Expected result");
			const item = original.store.items[0];
			if (!item) throw Error("Expected item");
			const result = await f.runtime.runPromise(
				Effect.either(
					f.controller.request({
						type: "caption",
						id: item.id,
						caption: { ...item.caption, text: "Hi" },
						base64: Buffer.from(gif(200)).toString("base64"),
					}),
				),
			);
			expect(result._tag).toBe("Left");
			expect((await f.files.read())?.items[0]).toEqual(item);
		} finally {
			await f.close();
		}
	});
});

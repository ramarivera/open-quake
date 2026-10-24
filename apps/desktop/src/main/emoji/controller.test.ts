import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { dialog } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import {
	defaultCaption,
	emptyEmojiStore,
} from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../packages/edge/src/emoji/emoji-repository";
import { EmojiLibrary } from "../../../../../packages/edge/src/emoji/emoji-service";
import { encodeGif } from "../../shared/gif";
import { ImageDecoder } from "../media/image-decoder";
import {
	type EmojiControllerPort,
	type EmojiGenerationPort,
	makeEmojiController,
} from "./controller";
import { emojiFiles } from "./files";
import { placeEmojiPackage } from "./profile-placement";

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	nativeImage: {},
}));
const gif = (delay = 120, red = 255) =>
	encodeGif({
		width: 2,
		height: 1,
		loopCount: 0,
		frames: [
			{
				rgba: new Uint8ClampedArray([red, 0, 0, 255, 0, 255, 0, 255]),
				delayMs: delay,
			},
		],
	});
async function setup(
	generation?: EmojiGenerationPort,
	place?: EmojiControllerPort["place"],
) {
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
				return {} as Electron.BrowserWindow;
			},
			place:
				place ??
				(async (_id, _state, persistLink) => {
					await persistLink("profile");
					return "profile";
				}),
			...(generation ? { generation } : {}),
		}),
	);
	return {
		root,
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
	it("imports a long GIF filename with a bounded derived name", async () => {
		const f = await setup();
		try {
			const name = "synthetic-motion-filename-longer-than-thirty-characters";
			const path = join(f.root, `${name}.gif`);
			await writeFile(path, gif());
			vi.mocked(dialog.showOpenDialog).mockResolvedValue({
				canceled: false,
				filePaths: [path],
			});
			const reply = await f.runtime.runPromise(
				f.controller.request({ type: "import-gif" }),
			);
			expect(reply._tag).toBe("ready");
			expect((await f.files.read())?.items[0]?.name).toBe(name.slice(0, 30));
		} finally {
			await f.close();
		}
	});
	it.each([undefined, "", "   "])(
		"bounds the static-derived generation name for blank input %s",
		async (name) => {
			const f = await setup({ generate: async () => gif() });
			try {
				const assetName =
					"synthetic-static-filename-longer-than-thirty-characters.png";
				await f.runtime.runPromise(
					Effect.flatMap(EmojiRepository, (repository) =>
						repository.transact((state) =>
							Effect.succeed({
								...state,
								staticAssets: [
									{ hash: f.hash, name: assetName, format: "image/png" },
								],
							}),
						),
					),
				);
				const reply = await f.runtime.runPromise(
					f.controller.request({
						type: "generate",
						assetId: f.hash,
						prompt: "Wave",
						...(name === undefined ? {} : { name }),
					}),
				);
				expect(reply).toMatchObject({
					_tag: "generated",
					name: assetName.slice(0, 30),
				});
			} finally {
				await f.close();
			}
		},
	);
	it("rejects explicit overlong names in generation and result creation", async () => {
		const f = await setup({ generate: async () => gif() });
		try {
			for (const input of [
				{
					type: "generate" as const,
					assetId: f.hash,
					prompt: "Wave",
					name: "x".repeat(31),
				},
				{
					type: "create-result" as const,
					base64: Buffer.from(gif()).toString("base64"),
					name: "x".repeat(31),
				},
			]) {
				const reply = await f.runtime.runPromise(
					Effect.either(f.controller.request(input)),
				);
				expect(reply._tag).toBe("Left");
				if (reply._tag === "Left")
					expect(reply.left.code).toBe("QUAKE.EMOJI.INVALID");
			}
			expect((await f.files.read())?.items).toEqual([]);
		} finally {
			await f.close();
		}
	});
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
	it("returns validated motion with entered metadata before atomic source/rendered persistence", async () => {
		const generate = vi.fn(async () => gif());
		const f = await setup({ generate });
		try {
			const result = await f.runtime.runPromise(
				f.controller.request({
					type: "generate",
					assetId: f.hash,
					prompt: "Wave",
					name: "Waving Cat",
					caption: { ...defaultCaption, text: "Hi!" },
				}),
			);
			expect(result._tag).toBe("generated");
			expect(generate).toHaveBeenCalledWith({
				bytes: Buffer.from([1, 2, 3]),
				format: "image/png",
				prompt: "Wave",
			});
			expect((await f.files.read())?.drafts).toHaveLength(0);
			if (result._tag !== "generated") throw Error("Expected generated motion");
			expect(result).toMatchObject({
				name: "Waving Cat",
				caption: { text: "Hi!" },
			});
			await f.runtime.runPromise(
				f.controller.request({
					...result,
					type: "create-result",
					renderedBase64: Buffer.from(gif(120, 120)).toString("base64"),
				}),
			);
			const item = (await f.files.read())?.items[0];
			expect(item).toMatchObject({
				name: "Waving Cat",
				caption: { text: "Hi!" },
			});
			expect(item?.original).not.toBe(item?.rendered);
			if (!item) throw Error("Expected saved item");
			expect(await f.files.get(item.original)).toEqual(Buffer.from(gif()));
			await f.runtime.runPromise(
				f.controller.request({
					type: "caption",
					id: item.id,
					caption: defaultCaption,
					base64: result.base64,
				}),
			);
			expect((await f.files.read())?.items[0]).toMatchObject({
				original: item.original,
				rendered: item.original,
				caption: defaultCaption,
			});
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
	it("exports repeated and concurrent batches without replacing prior files", async () => {
		const f = await setup();
		try {
			await f.runtime.runPromise(
				f.controller.request({
					type: "create-result",
					name: "Hello",
					base64: Buffer.from(gif()).toString("base64"),
				}),
			);
			const id = (await f.files.read())?.drafts[0];
			if (!id) throw Error("Expected draft");
			await f.runtime.runPromise(
				f.controller.request({
					type: "command",
					command: { type: "create-package", id: "daily", name: "Daily" },
				}),
			);
			await f.runtime.runPromise(
				f.controller.request({
					type: "command",
					command: { type: "add-drafts", packageId: "daily", ids: [id] },
				}),
			);
			vi.mocked(dialog.showOpenDialog).mockResolvedValue({
				canceled: false,
				filePaths: [f.root],
			});
			await f.runtime.runPromise(
				f.controller.request({ type: "export", id: "daily" }),
			);
			await f.runtime.runPromise(
				f.controller.request({
					type: "caption",
					id,
					caption: { ...defaultCaption, text: "New" },
					base64: Buffer.from(gif(120, 120)).toString("base64"),
				}),
			);
			await Promise.all(
				[1, 2].map(() =>
					f.runtime.runPromise(
						f.controller.request({ type: "export", id: "daily" }),
					),
				),
			);
			const batches = (await readdir(f.root)).filter((name) =>
				name.startsWith("Emoji-"),
			);
			expect(batches).toHaveLength(3);
			const contents = await Promise.all(
				batches.map((batch) => readFile(join(f.root, batch, "01-Hello.gif"))),
			);
			expect(
				contents.filter((bytes) => bytes.equals(Buffer.from(gif()))),
			).toHaveLength(1);
			expect(
				contents.filter((bytes) => bytes.equals(Buffer.from(gif(120, 120)))),
			).toHaveLength(2);
		} finally {
			await f.close();
		}
	});
	it("rejects mismatched initial caption timing without creating a half-saved draft", async () => {
		const f = await setup();
		try {
			const outcome = await f.runtime.runPromise(
				Effect.either(
					f.controller.request({
						type: "create-result",
						name: "Still",
						base64: Buffer.from(gif()).toString("base64"),
						renderedBase64: Buffer.from(gif(200)).toString("base64"),
						caption: { ...defaultCaption, text: "Hi" },
					}),
				),
			);
			expect(outcome._tag).toBe("Left");
			expect((await f.files.read())?.items).toEqual([]);
		} finally {
			await f.close();
		}
	});
	it("runs real profile compensation when the controller cannot persist package linkage", async () => {
		let disk = encodeProfileEnvelope(createInitialProfileEnvelope());
		const profiles = ManagedRuntime.make(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => disk,
						write: async (next) => {
							disk = next;
						},
					}),
				),
			),
		);
		let failLink = false;
		const f = await setup(
			undefined,
			placeEmojiPackage({
				runtime: profiles,
				select: async (id) => {
					failLink = true;
					await profiles.runPromise(
						Effect.flatMap(ProfileRepository, (repo) =>
							repo.transact((state) =>
								Effect.succeed({
									...state,
									activeByDevice: {
										...state.activeByDevice,
										"desktop-preview": { profileId: id, pageId: `${id}-page` },
									},
								}),
							),
						),
					);
				},
			}),
		);
		const filesWrite = f.files.write;
		// The repository holds this same port object; failure occurs only at linkage commit.
		f.files.write = async (next) => {
			if (failLink) throw Error("synthetic linkage disk failure");
			await filesWrite(next);
		};
		// Rebuild the emoji repository with the deliberately failing port and the real placement callback.
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				EmojiLibrary.DefaultWithoutDependencies,
				ImageDecoder.Default,
			).pipe(
				Layer.provideMerge(
					EmojiRepository.Default.pipe(
						Layer.provide(emojiStorageLayer(f.files)),
					),
				),
			),
		);
		try {
			const controller = await runtime.runPromise(
				makeEmojiController({
					files: f.files,
					management: () => ({}) as Electron.BrowserWindow,
					place: placeEmojiPackage({
						runtime: profiles,
						select: async (id) => {
							failLink = true;
							await profiles.runPromise(
								Effect.flatMap(ProfileRepository, (repo) =>
									repo.transact((state) =>
										Effect.succeed({
											...state,
											activeByDevice: {
												...state.activeByDevice,
												"desktop-preview": {
													profileId: id,
													pageId: `${id}-page`,
												},
											},
										}),
									),
								),
							);
						},
					}),
				}),
			);
			const original = await runtime.runPromise(
				controller.request({
					type: "create-result",
					name: "Hello",
					base64: Buffer.from(gif()).toString("base64"),
				}),
			);
			if (original._tag !== "ready" || !original.store.drafts[0])
				throw Error("Expected draft");
			await runtime.runPromise(
				controller.request({
					type: "command",
					command: { type: "create-package", id: "daily", name: "Daily" },
				}),
			);
			await runtime.runPromise(
				controller.request({
					type: "command",
					command: {
						type: "add-drafts",
						packageId: "daily",
						ids: [original.store.drafts[0]],
					},
				}),
			);
			const before = (
				await profiles.runPromise(
					Effect.flatMap(ProfileRepository, (repo) => repo.load()),
				)
			).envelope;
			const result = await runtime.runPromise(
				Effect.either(controller.request({ type: "place", id: "daily" })),
			);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left")
				expect(result.left.code).toBe("QUAKE.EMOJI.LIBRARY_FAILED");
			const after = (
				await profiles.runPromise(
					Effect.flatMap(ProfileRepository, (repo) => repo.load()),
				)
			).envelope;
			expect(after.profiles).toEqual(before.profiles);
			expect(after.activeByDevice).toEqual(before.activeByDevice);
			expect((await f.files.read())?.packages[0]?.profileId).toBeNull();
		} finally {
			await runtime.dispose();
			await profiles.dispose();
			await f.close();
		}
	});
});

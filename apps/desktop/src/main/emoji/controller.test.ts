import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	truncate,
	writeFile,
} from "node:fs/promises";
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
import { renameLinkedEmojiProfile } from "./profile-rename";

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	nativeImage: {
		createFromBuffer: () => ({
			getSize: () => ({ width: 1, height: 1 }),
			isEmpty: () => false,
		}),
	},
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
	renameLinked?: EmojiControllerPort["renameLinked"],
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
			...(renameLinked ? { renameLinked } : {}),
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
	it("keeps read, rename and settings replies metadata-only; fetches one typed asset on demand", async () => {
		const f = await setup();
		try {
			const get = vi.spyOn(f.files, "get");
			const commands = [
				{ type: "create-package" as const, id: "pack", name: "Pack" },
				{ type: "rename-package" as const, id: "pack", name: "Renamed" },
				{
					type: "settings" as const,
					appMatch: false,
					apps: [],
					globalMode: 0 as const,
				},
			];
			const read = await f.runtime.runPromise(
				f.controller.request({ type: "read" }),
			);
			expect(read).toMatchObject({ _tag: "ready", assets: {} });
			for (const command of commands) {
				expect(
					await f.runtime.runPromise(
						f.controller.request({ type: "command", command }),
					),
				).toMatchObject({ _tag: "ready", assets: {} });
			}
			expect(get).not.toHaveBeenCalled();
			const asset = await f.runtime.runPromise(
				f.controller.request({ type: "asset", hash: f.hash }),
			);
			expect(asset).toMatchObject({
				_tag: "ready",
				assets: { [f.hash]: "data:image/png;base64,AQID" },
			});
			expect(get.mock.calls).toEqual([[f.hash]]);
		} finally {
			await f.close();
		}
	});
	it("preserves actionable invalid placement failures from the real profile transaction", async () => {
		const profiles = ManagedRuntime.make(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () =>
							encodeProfileEnvelope(createInitialProfileEnvelope()),
						write: async () => {
							throw Error("Validation must precede writing");
						},
					}),
				),
			),
		);
		const f = await setup(
			undefined,
			placeEmojiPackage({ runtime: profiles, select: async () => {} }),
		);
		try {
			const created = await f.runtime.runPromise(
				f.controller.request({
					type: "create-result",
					name: "Hi",
					base64: Buffer.from(gif()).toString("base64"),
				}),
			);
			if (created._tag !== "ready" || !created.store.drafts[0])
				throw Error("Expected draft");
			await f.runtime.runPromise(
				f.controller.request({
					type: "command",
					command: {
						type: "create-package",
						id: "long",
						name: "Long package name",
					},
				}),
			);
			await f.runtime.runPromise(
				f.controller.request({
					type: "command",
					command: {
						type: "add-drafts",
						packageId: "long",
						ids: [created.store.drafts[0]],
					},
				}),
			);
			const result = await f.runtime.runPromise(
				Effect.either(f.controller.request({ type: "place", id: "long" })),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: {
					code: "QUAKE.EMOJI.INVALID",
					reason:
						"Use a unique package name of at most 10 weighted units before adding it to the screen.",
				},
			});
		} finally {
			await f.close();
			await profiles.dispose();
		}
	});

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
				signal: expect.any(AbortSignal),
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

for (const type of ["import-gif", "import-static"] as const) {
	for (const failure of ["corrupt", "oversized", "missing"] as const) {
		it(`returns committed ${type} progress when a later file is ${failure}`, async () => {
			const f = await setup();
			try {
				const first = join(f.root, "first"),
					second = join(f.root, "second"),
					last = join(f.root, "last");
				const valid =
					type === "import-gif"
						? gif()
						: Buffer.from(
								"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE5cAAAAASUVORK5CYII=",
								"base64",
							);
				await writeFile(first, valid);
				await writeFile(last, valid);
				if (failure !== "missing") await writeFile(second, "corrupt");
				if (failure === "oversized")
					await truncate(second, 8 * 1024 * 1024 + 1);
				vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
					canceled: false,
					filePaths: [first, second, last],
				});
				const reply = await f.runtime.runPromise(
					f.controller.request({ type }),
				);
				expect(reply._tag).toBe("ready");
				if (reply._tag !== "ready") throw new Error("Missing partial snapshot");
				expect(reply.notice).toContain(
					"1 imported before an error. Remaining files were not imported.",
				);
				expect(reply.notice).not.toContain(f.root);
				if (type === "import-gif") {
					expect(reply.store.items.map((item) => item.name)).toEqual(["first"]);
					expect(reply.store.drafts).toEqual([reply.store.items[0]?.id]);
				} else
					expect(reply.store.staticAssets.map((asset) => asset.name)).toEqual([
						"Source",
						"first",
					]);
				const persisted = await f.files.read();
				expect(persisted).toEqual(reply.store);
				expect(
					await f.runtime.runPromise(f.controller.request({ type: "read" })),
				).toMatchObject({ store: reply.store });
			} finally {
				await f.close();
			}
		});
	}
	it(`still rejects ${type} when the first file fails without a partial commit`, async () => {
		const f = await setup();
		try {
			const path = join(f.root, "invalid");
			await writeFile(path, "corrupt");
			const before = await f.files.read();
			vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
				canceled: false,
				filePaths: [path],
			});
			await expect(
				f.runtime.runPromise(f.controller.request({ type })),
			).rejects.toBeDefined();
			expect(await f.files.read()).toEqual(before);
		} finally {
			await f.close();
		}
	});
}

it("CENTER-084/087 edits draft metadata atomically and reloads it without creating a package", async () => {
	const f = await setup();
	try {
		await f.runtime.runPromise(
			f.controller.request({
				type: "create-result",
				name: "Draft",
				base64: Buffer.from(gif()).toString("base64"),
			}),
		);
		const initial = await f.runtime.runPromise(f.controller.snapshot());
		if (initial._tag !== "ready") throw Error("Not ready");
		const item = initial.store.items[0];
		if (!item) throw Error("No item");
		const result = await f.runtime.runPromise(
			f.controller.request({
				type: "caption",
				id: item.id,
				name: "Renamed",
				mode: 2,
				caption: { ...defaultCaption, text: "Hi" },
				base64: Buffer.from(gif(120, 100)).toString("base64"),
			}),
		);
		expect(result._tag).toBe("ready");
		const disk = await f.files.read();
		expect(disk?.packages).toEqual([]);
		expect(disk?.drafts).toEqual([item.id]);
		expect(disk?.items[0]).toMatchObject({
			name: "Renamed",
			mode: 2,
			original: item.original,
			caption: { text: "Hi" },
		});
		await expect(
			f.runtime.runPromise(
				f.controller.request({
					type: "caption",
					id: item.id,
					name: "x".repeat(31),
					caption: defaultCaption,
					base64: Buffer.from(gif()).toString("base64"),
				}),
			),
		).rejects.toBeDefined();
		expect(await f.files.read()).toEqual(disk);
	} finally {
		await f.close();
	}
});
it("CENTER-083 cancellation preserves sources and prevents a late candidate even when a port ignores abort", async () => {
	let finish: ((bytes: Uint8Array) => void) | undefined;
	const f = await setup({
		generate: () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	});
	try {
		const operation = f.runtime.runPromise(
			f.controller.request({
				type: "generate",
				assetId: f.hash,
				prompt: "Wave",
				caption: { ...defaultCaption, text: "Keep" },
			}),
		);
		await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
		await f.runtime.runPromise(
			f.controller.request({ type: "cancel-generation" }),
		);
		finish?.(gif());
		await expect(operation).rejects.toBeDefined();
		expect(await f.files.get(f.hash)).toEqual(Buffer.from([1, 2, 3]));
		expect((await f.files.read())?.drafts).toEqual([]);
	} finally {
		await f.close();
	}
});
it("CENTER-088 retains placed hashes after package deletion and collects after the final reference", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-emoji-collect-"));
	const files = emojiFiles(root);
	const hash = await files.put(gif());
	const published = await files.clipboardPath(hash);
	await files.write({
		...emptyEmojiStore,
		items: [
			{
				id: "pinned",
				name: "Pinned",
				original: hash,
				rendered: hash,
				caption: defaultCaption,
			},
		],
		packages: [
			{ id: "p", name: "Pack", emojiIds: ["pinned"], profileId: null },
		],
	});
	let refs = { ids: ["pinned"], hashes: [hash] };
	let collectionFails = true;
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
	try {
		const controller = await runtime.runPromise(
			makeEmojiController({
				files: {
					...files,
					collect: async (hashes) => {
						if (collectionFails) throw Error("Synthetic cleanup failure");
						await files.collect(hashes);
					},
				},
				management: () => ({}) as Electron.BrowserWindow,
				place: async () => "",
				references: async () => refs,
			}),
		);
		const deletion = await runtime.runPromise(
			controller.request({
				type: "command",
				command: { type: "delete-package", id: "p" },
			}),
		);
		expect(deletion).toMatchObject({
			_tag: "ready",
			notice: expect.stringContaining("cleanup was deferred"),
		});
		expect((await files.read())?.packages).toEqual([]);
		collectionFails = false;
		expect((await files.read())?.items).toHaveLength(1);
		expect(await files.get(hash)).toEqual(Buffer.from(gif()));
		refs = { ids: [], hashes: [] };
		await runtime.runPromise(controller.request({ type: "read" }));
		expect((await files.read())?.items).toEqual([]);
		await expect(files.get(hash)).rejects.toMatchObject({ code: "ENOENT" });
		// The native clipboard still advertises this path after its last library
		// reference disappears. Reopening the library must not break paste.
		expect(await readFile(published)).toEqual(Buffer.from(gif()));
		await emojiFiles(root).collect([]);
		expect(await readFile(published)).toEqual(Buffer.from(gif()));
	} finally {
		await runtime.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

it("preserves linked-name validation errors while retaining unexpected storage failures", async () => {
	const initial = createInitialProfileEnvelope();
	const template = initial.profiles[0];
	if (!template) throw Error("Missing initial profile");
	let disk = encodeProfileEnvelope({
		...initial,
		profiles: [
			...initial.profiles,
			{ ...template, id: "linked", name: "Pack" },
			{ ...template, id: "other", name: "Other" },
		],
	});
	let failWrite = false;
	const writes = vi.fn(async (next: typeof disk) => {
		if (failWrite) throw Error("secret-storage-token");
		disk = next;
	});
	const profiles = ManagedRuntime.make(
		ProfileRepository.Default.pipe(
			Layer.provide(
				profileStorageLayer({ read: async () => disk, write: writes }),
			),
		),
	);
	const refresh = vi.fn(async () => {});
	const f = await setup(
		undefined,
		undefined,
		renameLinkedEmojiProfile({ runtime: profiles, refresh }),
	);
	try {
		await f.runtime.runPromise(
			Effect.flatMap(EmojiRepository, (repository) =>
				repository.transact((state) =>
					Effect.succeed({
						...state,
						packages: [
							{ id: "pack", name: "Pack", emojiIds: [], profileId: "linked" },
						],
					}),
				),
			),
		);
		const libraryBefore = await f.files.read();
		const profilesBefore = disk;
		for (const name of ["Other", "ElevenChars"]) {
			const result = await f.runtime.runPromise(
				Effect.either(
					f.controller.request({
						type: "command",
						command: { type: "rename-package", id: "pack", name },
					}),
				),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: {
					_tag: "EmojiInvalid",
					code: "QUAKE.EMOJI.INVALID",
					reason: "Use a unique profile name of at most 10 weighted units.",
				},
			});
			expect(await f.files.read()).toEqual(libraryBefore);
			expect(disk).toEqual(profilesBefore);
		}
		expect(writes).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		failWrite = true;
		const failed = await f.runtime.runPromise(
			Effect.either(
				f.controller.request({
					type: "command",
					command: { type: "rename-package", id: "pack", name: "Valid" },
				}),
			),
		);
		expect(failed).toMatchObject({
			_tag: "Left",
			left: { _tag: "EmojiLibraryFailed", code: "QUAKE.EMOJI.LIBRARY_FAILED" },
		});
		if (failed._tag !== "Left" || failed.left._tag !== "EmojiLibraryFailed")
			throw Error("Expected storage failure");
		expect(failed.left.originalCause).toBeDefined();
		expect(Object.keys(failed.left)).not.toContain("originalCause");
		expect(JSON.stringify(failed.left)).not.toContain("secret-storage-token");
		expect(await f.files.read()).toEqual(libraryBefore);
		expect(disk).toEqual(profilesBefore);
	} finally {
		await f.close();
		await profiles.dispose();
	}
});

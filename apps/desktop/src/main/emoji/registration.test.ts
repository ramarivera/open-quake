import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { type BrowserWindow, ipcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service";
import { emptyEmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import {
	EmojiLibrary,
	EmojiPress,
} from "../../../../../packages/edge/src/emoji/emoji-service";
import {
	EMOJI_PRESS,
	EMOJI_REQUEST,
	type EmojiReply,
} from "../../shared/emoji";
import { tinyFixture } from "../../shared/gif/fixtures";
import * as foreground from "../profiles/foreground-app";
import { emojiFiles } from "./files";
import { prepareEmoji } from "./index";

vi.mock("electron", () => ({
	app: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	nativeImage: {},
}));
const windowStub = () =>
	({
		webContents: {
			mainFrame: {},
			getURL: () => "file:///synthetic/index.html",
		},
	}) as unknown as BrowserWindow;
const eventFor = (window: BrowserWindow) =>
	({
		sender: window.webContents,
		senderFrame: window.webContents.mainFrame,
	}) as Electron.IpcMainInvokeEvent;
async function setup(
	clipboard: (path: string) => Promise<void> = async () => {},
) {
	const root = await mkdtemp(join(tmpdir(), "oq-emoji-registration-"));
	const files = emojiFiles(root);
	const hash = await files.put(Buffer.from(tinyFixture, "base64"));
	const privateHash = await files.put(
		Buffer.from("private synthetic static image"),
	);
	await files.write({
		...emptyEmojiStore,
		items: [
			{
				id: "e",
				name: "Visible",
				original: hash,
				rendered: hash,
				caption: { text: "", size: 48, position: "bot", color: "0xffffffff" },
			},
		],
		appMatch: false,
		globalMode: 0,
		staticAssets: [{ hash: privateHash, name: "Private", format: "image/png" }],
	});
	let disk = encodeProfileEnvelope(createInitialProfileEnvelope());
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProfileService.DefaultWithoutDependencies,
			ProfileManager.DefaultWithoutDependencies,
			ProfileSwitching.DefaultWithoutDependencies,
		).pipe(
			Layer.provideMerge(
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
			),
			Layer.provide(
				Layer.succeed(ProfileSwitchingPort, {
					platform: "darwin",
					foreground: () => Effect.succeed(Option.none()),
					push: () => Effect.void,
				}),
			),
		),
	);
	await runtime.runPromise(
		Effect.flatMap(ProfileRepository, (repo) =>
			repo.transact((envelope) => {
				const first = envelope.profiles[0];
				const page = first.pages[0];
				const key = Schema.decodeUnknownSync(ProfileKey)({
					keyCode: "1,1",
					childrenName: "emoji",
					config: {
						type: "emoji",
						display: true,
						size: [1, 1],
						supportKnob: false,
						supportTouchEffect: true,
						icon: `emoji:${hash}`,
						title: {
							text: "Visible",
							pos: "bot",
							size: 8,
							color: "#ffffff",
							display: true,
							style: "bold",
						},
						actions: [],
					},
				});
				return Effect.succeed({
					...envelope,
					profiles: [
						{
							...first,
							pages: [
								{
									...page,
									keys: [
										{
											...key,
											config: {
												...key.config,
												type: "emoji",
												display: true,
												icon: `emoji:${hash}`,
												actions: [
													{
														type: "emojiConfig",
														value: { packageId: "p", emojiId: "e", hash },
													},
												],
											},
										},
									],
								},
								...first.pages.slice(1),
							],
						},
						...envelope.profiles.slice(1),
					],
					activeByDevice: {
						"desktop-preview": { profileId: first.id, pageId: page.id },
					},
				});
			}),
		),
	);
	const management = windowStub();
	const panel = windowStub();
	const stranger = windowStub();
	const thumbnail = windowStub();
	let captureEnabled = true;
	let serial = "desktop-preview";
	vi.mocked(ipcMain.handle).mockClear();
	const prepared = prepareEmoji({
		root,
		management: () => management,
		panel: () => panel,
		profiles: {
			runtime,
			select: async () =>
				(await runtime.runPromise(ProfileService.loadProfiles())).envelope,
			refresh: async () => {},
			thumbnailProfile: (sender) =>
				captureEnabled && sender === thumbnail.webContents
					? disk.profiles[0] &&
						Schema.decodeUnknownSync(Profile)(disk.profiles[0])
					: undefined,
		},
		bus: () => undefined,
		renderer: "file:///synthetic/index.html",
		mock: true,
		platform: "darwin",
		selectionSerial: async () => serial,
		clipboard,
	});
	const application = ManagedRuntime.make(prepared.layer);
	prepared.bind(application);
	await application.runtime();
	const registered = prepared.start();
	const requestHandler = vi
		.mocked(ipcMain.handle)
		.mock.calls.find(([name]) => name === EMOJI_REQUEST)?.[1];
	const pressHandler = vi
		.mocked(ipcMain.handle)
		.mock.calls.find(([name]) => name === EMOJI_PRESS)?.[1];
	if (!requestHandler || !pressHandler)
		throw Error("Missing production handlers");
	const envelope = (await runtime.runPromise(ProfileService.loadProfiles()))
		.envelope;
	const profile = envelope.profiles[0];
	return {
		root,
		files,
		hash,
		privateHash,
		registered,
		application,
		runtime,
		management,
		panel,
		stranger,
		thumbnail,
		revokeCapture: () => {
			captureEnabled = false;
		},
		request: (
			window: BrowserWindow,
			input: unknown,
			subframe = false,
		): Promise<EmojiReply> =>
			requestHandler(
				subframe
					? { ...eventFor(window), senderFrame: null }
					: eventFor(window),
				input,
			),
		press: (
			window: BrowserWindow,
			profileId = profile.id,
			pageId = profile.pages[0].id,
		) =>
			pressHandler(eventFor(window), {
				profileId,
				pageId,
				keyCode: profile.pages[0].keys[0]?.keyCode,
				keyAction: 1,
			}),
		setSerial: (value: string) => {
			serial = value;
		},
		close: async () => {
			await registered.dispose();
			await application.dispose();
			await runtime.dispose();
			await rm(root, { force: true, recursive: true });
		},
	};
}
it("retains the scoped foreground adapter until application disposal", async () => {
	const acquire = foreground.makeScopedForegroundProbe;
	const native = vi.fn(async () => Option.none());
	const acquisition = vi
		.spyOn(foreground, "makeScopedForegroundProbe")
		.mockImplementationOnce((platform) => acquire(platform, native));
	const f = await setup();
	try {
		expect(acquisition).toHaveBeenCalledOnce();
		expect(native).not.toHaveBeenCalled();
		await f.application.runPromise(
			EmojiLibrary.command({
				type: "settings",
				appMatch: true,
				apps: [{ name: "Synthetic", path: "/synthetic.app", identifier: "" }],
				globalMode: 0,
			}),
		);
		const service = await f.application.runPromise(EmojiPress);
		const press = service.press(
			{ packageId: "fixture", emojiId: "e", hash: f.hash },
			0,
			1,
		);
		await f.registered.dispose();
		expect(await f.application.runPromise(press)).toBe("ignored");
		expect(native).toHaveBeenCalledOnce();
		await f.application.dispose();
		const after = await Effect.runPromise(press.pipe(Effect.either));
		expect(after).toMatchObject({
			_tag: "Left",
			left: { code: "QUAKE.EMOJI.FOREGROUND_FAILED" },
		});
	} finally {
		await f.close();
		acquisition.mockRestore();
	}
});

describe("production emoji IPC boundaries", () => {
	it("denies unowned windows and panel library reads; projects only a visible committed asset", async () => {
		const f = await setup();
		try {
			expect(await f.request(f.stranger, { type: "read" })).toMatchObject({
				_tag: "failure",
				code: "QUAKE.EMOJI.REQUEST_DENIED",
			});
			expect(await f.request(f.panel, { type: "read" })).toMatchObject({
				_tag: "failure",
			});
			expect(
				await f.request(f.panel, { type: "asset", hash: f.privateHash }),
			).toMatchObject({ _tag: "failure" });
			expect(await f.request(f.panel, { type: "asset", hash: f.hash })).toEqual(
				{
					_tag: "ready",
					store: emptyEmojiStore,
					assets: { [f.hash]: `data:image/gif;base64,${tinyFixture}` },
					apps: [],
					notice: "",
				},
			);
			expect(await f.request(f.management, { type: "read" })).toMatchObject({
				_tag: "ready",
				store: { staticAssets: [{ name: "Private" }] },
			});
			await f.runtime.runPromise(
				Effect.flatMap(ProfileRepository, (repo) =>
					repo.transact((current) =>
						Effect.succeed({
							...current,
							profiles: [
								{
									...current.profiles[0],
									pages: [
										{ ...current.profiles[0].pages[0], keys: [] },
										...current.profiles[0].pages.slice(1),
									],
								},
								...current.profiles.slice(1),
							],
						}),
					),
				),
			);
			expect(
				await f.request(f.panel, { type: "asset", hash: f.hash }),
			).toMatchObject({ _tag: "failure" });
		} finally {
			await f.close();
		}
	});
	it("gives registered thumbnail windows only their captured profile assets and revokes that capability", async () => {
		const f = await setup();
		try {
			expect(
				await f.request(f.thumbnail, { type: "asset", hash: f.hash }),
			).toMatchObject({ _tag: "ready", store: emptyEmojiStore });
			for (const input of [
				{ type: "read" },
				{ type: "asset", hash: f.privateHash },
				{
					type: "command",
					command: { type: "create-package", id: "bad", name: "Bad" },
				},
			])
				expect(await f.request(f.thumbnail, input)).toMatchObject({
					_tag: "failure",
					code: "QUAKE.EMOJI.REQUEST_DENIED",
				});
			expect(
				await f.request(f.thumbnail, { type: "asset", hash: f.hash }, true),
			).toMatchObject({ _tag: "failure" });
			expect(await f.press(f.thumbnail)).toEqual({ _tag: "invalid" });
			f.revokeCapture();
			expect(
				await f.request(f.thumbnail, { type: "asset", hash: f.hash }),
			).toMatchObject({ _tag: "failure" });
		} finally {
			await f.close();
		}
	});

	it("uses the panel selection for device input, rejects stale profiles and awaits an in-flight copy on disposal", async () => {
		let release: (() => void) | undefined;
		let started: (() => void) | undefined;
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		const copied: string[] = [];
		const f = await setup(async (path) => {
			copied.push(path);
			started?.();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		});
		try {
			expect(await f.press(f.stranger)).toEqual({ _tag: "invalid" });
			expect(await f.press(f.panel, "stale-profile")).toEqual({
				_tag: "ignored",
			});
			// A physical session serial with no saved entry uses the same visible fallback as the panel.
			f.setSerial("synthetic-physical-session");
			const pressing = f.press(f.panel);
			await entered;
			expect(copied[0]).toMatch(/\.gif$/);
			expect(await readFile(copied[0] ?? "")).toEqual(
				Buffer.from(tinyFixture, "base64"),
			);
			let disposed = false;
			const closing = f.registered.dispose();
			expect(f.registered.dispose()).toBe(closing);
			void closing.then(() => {
				disposed = true;
			});
			await Promise.resolve();
			expect(disposed).toBe(false);
			release?.();
			expect(await pressing).toEqual({ _tag: "handled" });
			await closing;
			expect(disposed).toBe(true);
			expect(await f.request(f.management, { type: "read" })).toMatchObject({
				_tag: "failure",
			});
		} finally {
			release?.();
			await f.close();
		}
	});
});

it("keeps a retained unsupported emoji import inert at the registered press boundary", async () => {
	const copied: string[] = [];
	const f = await setup(async (path) => {
		copied.push(path);
	});
	try {
		expect(await f.press(f.panel)).toEqual({ _tag: "handled" });
		expect(copied).toHaveLength(1);
		const retained = await f.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) =>
				repo.transact((envelope) =>
					Effect.succeed(
						Schema.decodeUnknownSync(Schema.typeSchema(ProfileEnvelope))({
							...envelope,
							profiles: envelope.profiles.map((profile, i) =>
								i !== 0
									? profile
									: {
											...profile,
											pages: profile.pages.map((page, j) =>
												j !== 0
													? page
													: {
															...page,
															keys: page.keys.map((key) => ({
																...key,
																compatibility: Option.some({
																	unsupported: true,
																	retained: "synthetic-import",
																}),
															})),
														},
											),
										},
							),
						}),
					),
				),
			),
		);
		const key = retained.profiles[0].pages[0].keys[0];
		expect(key?.config.type).toBe("emoji");
		expect(key?.config.actions).toHaveLength(1);
		for (let n = 0; n < 2; n++)
			expect(await f.press(f.panel)).toEqual({ _tag: "ignored" });
		expect(copied).toHaveLength(1);
		const after = await f.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) => repo.load()),
		);
		expect(after.envelope.profiles[0].pages[0].keys[0]).toEqual(key);
	} finally {
		await f.close();
	}
});

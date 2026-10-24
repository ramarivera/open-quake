import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service.js";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { KEY_REQUEST, type KeyReply } from "../../shared/key-library";
import { iconZip } from "../test/icon-pack-fixtures";
import { iconStore } from "./icon-store";
import { registerKeyLibrary } from "./registration";

const electron = vi.hoisted(() => {
	const windows: object[] = [];
	let id = 0;
	return {
		windows,
		app: { getPath: vi.fn(() => "/nonexistent/key-registration-synthetic") },
		dialog: {
			showOpenDialog:
				vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
		},
		nativeImage: {},
		ipcMain: {
			handle:
				vi.fn<
					(
						channel: string,
						handler: (
							event: {
								sender: {
									id: number;
									mainFrame: object;
									getURL: () => string;
									isDestroyed: () => boolean;
								};
								senderFrame: object;
							},
							input: unknown,
						) => Promise<KeyReply>,
					) => void
				>(),
			removeHandler: vi.fn(),
		},
		nextId: () => ++id,
	};
});
vi.mock("electron", () => ({
	...electron,
	BrowserWindow: class {
		webContents = Object.assign(new EventEmitter(), {
			id: electron.nextId(),
			mainFrame: {},
			url: "file:///app/index.html",
			getURL() {
				return this.url;
			},
			isDestroyed: () => false,
			send: vi.fn(),
		});
		constructor() {
			electron.windows.push(this);
		}
		isDestroyed = () => false;
		static getAllWindows = () => electron.windows;
		static fromWebContents = () => true;
	},
}));
const directories: string[] = [];
afterEach(async () => {
	electron.windows.length = 0;
	electron.app.getPath.mockReturnValue(
		"/nonexistent/key-registration-synthetic",
	);
	electron.dialog.showOpenDialog.mockReset();
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});
function fixture(
	config: Readonly<Record<string, unknown>> = {},
	execute: () => Effect.Effect<void> = () => Effect.void,
) {
	let pause: Promise<void> | undefined;
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = {
		...empty,
		childrenName: "timer",
		config: {
			...empty.config,
			type: "timer",
			display: true,
			actions: [{ type: "time", value: 60 }],
			...config,
		},
	};
	let stored: unknown = {
		schemaVersion: 1,
		profiles: [
			{ id: "p", name: "P", revision: 0, pages: [{ id: "one", keys: [key] }] },
			{ id: "q", name: "Q", revision: 0, pages: [{ id: "one", keys: [] }] },
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	};
	const published: { countdown?: number; profileId: string }[] = [];
	const profiles = ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => stored,
						write: async (next) => {
							stored = next;
						},
					}),
				),
			),
		),
	);
	const layer = Layer.mergeAll(
		KeyEditing.DefaultWithoutDependencies,
		KeyRuntime.DefaultWithoutDependencies.pipe(
			Layer.provide(
				Layer.effect(
					KeyRuntimePort,
					Effect.gen(function* () {
						const service = yield* ProfileService;
						return {
							read: Effect.promise(() => pause ?? Promise.resolve())
								.pipe(Effect.zipRight(service.loadProfiles()))
								.pipe(
									Effect.map((r) => r.envelope),
									Effect.orDie,
								),
							execute,
							select: (deviceId, profileId, pageId) =>
								service
									.selectProfile({ deviceId, profileId, pageId })
									.pipe(Effect.asVoid, Effect.orDie),
							alarm: () => Effect.void,
							publish: (state: { countdown?: number; profileId: string }) =>
								Effect.sync(() => {
									published.push(state);
								}),
						};
					}),
				),
			),
		),
	).pipe(Layer.provideMerge(profiles));
	const runtime = ManagedRuntime.make(layer);
	const manager = new BrowserWindow(),
		panel = new BrowserWindow(),
		impostor = new BrowserWindow();
	const urls = new Map([
		[manager.webContents, "file:///app/index.html"],
		[panel.webContents, "file:///app/index.html?surface=panel"],
		[impostor.webContents, "file:///app/index.html?surface=panel"],
	]);
	for (const [wc, url] of urls) vi.spyOn(wc, "getURL").mockReturnValue(url);
	const registration = registerKeyLibrary(
		runtime,
		() => manager,
		"file:///app/index.html",
		undefined,
		() => panel,
	);
	const handler = [...electron.ipcMain.handle.mock.calls]
		.reverse()
		.find(([channel]) => channel === KEY_REQUEST)?.[1];
	if (!handler) throw new Error("Missing key IPC");
	const request = (win: BrowserWindow, input: unknown) =>
		handler(
			{ sender: win.webContents, senderFrame: win.webContents.mainFrame },
			input,
		);
	const activation = {
		type: "activate",
		deviceId: "device",
		profileId: "p",
		pageId: "one",
		revision: 0,
		keyCode: "1,1",
		kind: "press",
	};
	return {
		key,
		pauseRead: (value: Promise<void> | undefined) => {
			pause = value;
		},
		runtime,
		registration,
		manager,
		panel,
		impostor,
		request,
		activation,
		published,
	};
}
it("requires the owned panel and top-level app document, including at queued execution", async () => {
	const f = fixture();
	try {
		for (const win of [f.impostor, f.manager]) {
			vi.spyOn(win.webContents, "getURL").mockReturnValue(
				"file:///app/index.html?surface=panel",
			);
			for (const command of [
				f.activation,
				{ type: "navigate", deviceId: "device", direction: 1 },
			])
				expect(await f.request(win, command)).toEqual({
					_tag: "rejected",
					reason: "unauthorized",
				});
		}
		vi.spyOn(f.panel.webContents, "getURL").mockReturnValue(
			"https://example.invalid/?surface=panel",
		);
		expect((await f.request(f.panel, f.activation))._tag).toBe("rejected");
		vi.spyOn(f.panel.webContents, "getURL").mockReturnValue(
			"file:///app/index.html?surface=panel",
		);
		expect((await f.request(f.panel, f.activation))._tag).toBe("success");
		expect(
			(await f.request(f.panel, { ...f.activation, kind: "release" }))._tag,
		).toBe("success");
		expect(
			(
				await f.request(f.panel, {
					type: "delete",
					target: {
						token: "x",
						profileId: "p",
						pageId: "one",
						revision: 0,
						keyCode: "1,1",
					},
				})
			)._tag,
		).toBe("rejected");
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

async function importFixture() {
	const directory = await mkdtemp(join(tmpdir(), "icon-ipc-review-"));
	directories.push(directory);
	electron.app.getPath.mockReturnValue(directory);
	const svg =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>';
	const localPath = join(directory, "square.svg"),
		packPath = join(directory, "pack.zip");
	await writeFile(localPath, svg);
	await writeFile(
		packPath,
		iconZip([
			{
				name: "manifest.json",
				data: JSON.stringify({ Name: "Synthetic pack" }),
			},
			{
				name: "icons.json",
				data: JSON.stringify([{ path: "square.svg", name: "Square" }]),
			},
			{ name: "icons/square.svg", data: svg },
		]),
	);
	return { directory, localPath, packPath };
}
it("deletes only local collection entries through IPC and preserves the installed pack across restart", async () => {
	const files = await importFixture(),
		f = fixture();
	try {
		electron.dialog.showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: [files.packPath],
		});
		const installed = await f.request(f.manager, { type: "import-pack" });
		if (installed._tag !== "success" || !installed.packs?.[0])
			throw new Error("Pack import failed");
		const pack = installed.packs[0],
			id = pack.icons[0]?.id;
		assertId(id);
		expect(
			await f.request(f.manager, { type: "remove-icon", id }),
		).toMatchObject({ _tag: "rejected" });
		electron.dialog.showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: [files.localPath],
		});
		const local = await f.request(f.manager, { type: "import-icon" });
		if (local._tag !== "success") throw new Error("Local import failed");
		expect(local.packs?.find((p) => p.id === "local")?.icons[0]?.id).toBe(id);
		const removed = await f.request(f.manager, { type: "remove-icon", id });
		expect(removed).toMatchObject({ _tag: "success" });
		const restarted = await Effect.runPromise(
			iconStore(join(files.directory, "key-library-v1.json")).read(),
		);
		expect(restarted.find((p) => p.id === pack.id)).toEqual(pack);
		expect(restarted.find((p) => p.id === "local")?.icons).toEqual([]);
		electron.dialog.showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: [files.packPath],
		});
		expect(await f.request(f.manager, { type: "import-pack" })).toMatchObject({
			_tag: "success",
			packs: expect.arrayContaining([pack]),
		});
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});
function assertId(id: string | undefined): asserts id is string {
	if (!id) throw new Error("Missing icon id");
}
it("protects local icons referenced by alternate drafts and committed keys", async () => {
	const files = await importFixture(),
		f = fixture();
	try {
		electron.dialog.showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: [files.localPath],
		});
		const imported = await f.request(f.manager, { type: "import-icon" });
		if (imported._tag !== "success") throw new Error("Local import failed");
		const icon = imported.packs?.find((p) => p.id === "local")?.icons[0];
		if (!icon) throw new Error("Missing local icon");
		const target = {
			token: "icon-reference",
			profileId: "p",
			pageId: "one",
			keyCode: "1,1",
			revision: 0,
		};
		const key = { ...f.key, config: { ...f.key.config, alterIcon: icon.data } };
		expect(
			await f.request(f.manager, { type: "preview", target, key }),
		).toMatchObject({ _tag: "success" });
		expect(
			await f.request(f.manager, { type: "remove-icon", id: icon.id }),
		).toMatchObject({
			_tag: "rejected",
			reason: "This icon is currently in use and cannot be deleted.",
		});
		expect(
			await f.request(f.manager, { type: "save", token: target.token }),
		).toMatchObject({ _tag: "success" });
		expect(
			await f.request(f.manager, { type: "remove-icon", id: icon.id }),
		).toMatchObject({
			_tag: "rejected",
			reason: "This icon is currently in use and cannot be deleted.",
		});
		expect(
			(
				await Effect.runPromise(
					iconStore(join(files.directory, "key-library-v1.json")).read(),
				)
			)[0]?.icons,
		).toEqual([icon]);
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});
function barrier<A>() {
	let resolve = (_value: A) => {};
	const promise = new Promise<A>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
it("cancels a sequence and navigates through the panel while an import chooser is stalled", async () => {
	await importFixture();
	const entered = barrier<void>(),
		chooser = barrier<{ canceled: boolean; filePaths: string[] }>(),
		started = barrier<void>(),
		continueFirst = barrier<void>();
	let calls = 0;
	electron.dialog.showOpenDialog.mockImplementation(() => {
		entered.resolve();
		return chooser.promise;
	});
	const f = fixture(
		{
			type: "multiActions",
			subActions: ["a", "b"].map((value) => ({
				config: { type: "hotkey", actions: [{ type: "key", value }], gap: 0 },
			})),
		},
		() =>
			Effect.sync(() => {
				calls++;
				started.resolve();
			}).pipe(Effect.zipRight(Effect.promise(() => continueFirst.promise))),
	);
	let importing: Promise<KeyReply> | undefined;
	try {
		await f.request(f.panel, f.activation);
		await started.promise;
		await f.request(f.panel, { ...f.activation, kind: "release" });
		importing = f.request(f.manager, { type: "import-icon" });
		await entered.promise;
		const cancel = f.request(f.panel, f.activation);
		expect(
			await Promise.race([
				cancel,
				new Promise<string>((done) =>
					setTimeout(() => done("blocked by chooser"), 400),
				),
			]),
		).toEqual({ _tag: "success" });
		expect(
			await Promise.race([
				f.request(f.panel, {
					type: "navigate",
					deviceId: "device",
					direction: 1,
				}),
				new Promise<string>((done) =>
					setTimeout(() => done("navigation blocked"), 400),
				),
			]),
		).toEqual({ _tag: "success" });
		continueFirst.resolve();
		await new Promise<void>((done) => setTimeout(done, 20));
		expect(calls).toBe(1);
		chooser.resolve({ canceled: true, filePaths: [] });
		expect(await importing).toMatchObject({ _tag: "success", packs: [] });
		expect(calls).toBe(1);
	} finally {
		continueFirst.resolve();
		chooser.resolve({ canceled: true, filePaths: [] });
		await importing;
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});
it.each(["navigation", "shutdown"])(
	"rejects late prepared imports after owner %s and awaits pending work",
	async (mode) => {
		const files = await importFixture(),
			f = fixture();
		const entered = barrier<void>(),
			chooser = barrier<{ canceled: boolean; filePaths: string[] }>();
		electron.dialog.showOpenDialog.mockImplementation(() => {
			entered.resolve();
			return chooser.promise;
		});
		const importing = f.request(f.manager, { type: "import-icon" });
		let disposing: Promise<void> | undefined;
		try {
			await entered.promise;
			if (mode === "navigation")
				vi.spyOn(f.manager.webContents, "getURL").mockReturnValue(
					"https://foreign.invalid",
				);
			else disposing = f.registration.dispose();
			chooser.resolve({ canceled: false, filePaths: [files.localPath] });
			expect(await importing).toEqual({
				_tag: "rejected",
				reason: "unauthorized",
			});
			await disposing;
			expect(
				await Effect.runPromise(
					iconStore(join(files.directory, "key-library-v1.json")).read(),
				),
			).toEqual([]);
		} finally {
			chooser.resolve({ canceled: true, filePaths: [] });
			await importing;
			if (disposing) await disposing;
			else await f.registration.dispose();
			await f.runtime.dispose();
		}
	},
);
it("refreshes a completed inactive countdown on externally committed selection", async () => {
	const f = fixture();
	try {
		await f.runtime.runPromise(ProfileService.loadProfiles());
		expect((await f.request(f.panel, f.activation))._tag).toBe("success");
		await f.request(f.panel, { ...f.activation, kind: "release" });
		await f.runtime.runPromise(
			ProfileService.selectProfile({
				deviceId: "device",
				profileId: "q",
				pageId: "one",
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 110));
		const before = f.published.length;
		await f.runtime.runPromise(
			ProfileService.selectProfile({
				deviceId: "device",
				profileId: "p",
				pageId: "one",
			}),
		);
		await vi.waitFor(() =>
			expect(
				f.published
					.slice(before)
					.some((s) => s.profileId === "p" && s.countdown === -1),
			).toBe(true),
		);
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("rechecks panel authority after waiting for a prior request", async () => {
	const f = fixture();
	let unblock: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		unblock = resolve;
	});
	try {
		await f.runtime.runPromise(ProfileService.loadProfiles());
		f.pauseRead(gate);
		const first = f.request(f.panel, f.activation);
		await new Promise((resolve) => setTimeout(resolve, 10));
		const queued = f.request(f.panel, {
			type: "navigate",
			deviceId: "device",
			direction: 1,
		});
		vi.spyOn(f.panel.webContents, "getURL").mockReturnValue(
			"https://example.invalid/?surface=panel",
		);
		f.pauseRead(undefined);
		unblock?.();
		await first;
		expect(await queued).toEqual({ _tag: "rejected", reason: "unauthorized" });
	} finally {
		unblock?.();
		f.pauseRead(undefined);
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

import { EventEmitter } from "node:events";
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
import { registerKeyLibrary } from "./registration";

const electron = vi.hoisted(() => {
	const windows: object[] = [];
	let id = 0;
	return {
		windows,
		app: { getPath: () => "/nonexistent/key-registration-synthetic" },
		dialog: {},
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
afterEach(() => {
	electron.windows.length = 0;
});
function fixture() {
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
							execute: () => Effect.void,
							select: () => Effect.void,
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

import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { emptyKnobResource } from "../../../../../packages/device/src/knob/knob-invariants.js";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service.js";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileFunctionContracts } from "../../../../../packages/device/src/profiles/profile-function-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { createPanelKeyDispatcher } from "../../renderer/src/keys/panel-key-dispatch";
import {
	KEY_REQUEST,
	type KeyReply,
	type LibraryPack,
} from "../../shared/key-library";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
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
		nativeImage: {
			createFromDataURL: vi.fn((data: string) => ({
				isEmpty: () => false,
				getSize: () => ({ width: 170, height: 170 }),
				toDataURL: () => data,
			})),
		},
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
	BrowserWindow: class extends EventEmitter {
		destroyed = false;
		webContents = Object.assign(new EventEmitter(), {
			id: electron.nextId(),
			mainFrame: {},
			url: "file:///app/index.html",
			getURL() {
				return this.url;
			},
			isDestroyed: () => false,
			send: vi.fn(),
			setWindowOpenHandler: vi.fn(),
		});
		constructor(readonly options: BrowserWindowConstructorOptions = {}) {
			super();
			electron.windows.push(this);
		}
		isDestroyed = () => this.destroyed;
		loadURL = async (url: string): Promise<void> => {
			this.webContents.url = url;
		};
		destroy = (): void => {
			this.destroyed = true;
			this.emit("closed");
		};
		show = vi.fn();
		showInactive = vi.fn();
		static getAllWindows = () => electron.windows;
		static fromWebContents = () => true;
	},
}));
const appIcons = vi.hoisted(() => ({
	load: vi.fn<() => Promise<LibraryPack>>(),
}));
vi.mock("./application-icons", () => ({
	applicationIconLibrary: () => appIcons.load,
}));
const directories: string[] = [];
afterEach(async () => {
	electron.windows.length = 0;
	electron.app.getPath.mockReturnValue(
		"/nonexistent/key-registration-synthetic",
	);
	electron.dialog.showOpenDialog.mockReset();
	appIcons.load.mockReset();
	for (const dir of directories.splice(0))
		await rm(dir, { recursive: true, force: true });
});

it("routes geometry and page edits through the authorized typed Keys consumer", async () => {
	const f = fixture();
	const target = {
		token: "geometry-ipc",
		profileId: "p",
		pageId: "one",
		keyCode: "1,1",
		revision: 0,
	};
	try {
		const commands = [
			{ type: "preview", target, key: f.key, geometry: { destination: "2,8" } },
			{
				type: "add-page",
				profileId: "p",
				pageId: "two",
				revision: 0,
				deviceId: "device",
			},
			{ type: "inspect-import", source: JSON.stringify([f.key]) },
			{ type: "import-profile", source: JSON.stringify([f.key]) },
		];
		for (const command of commands)
			expect(await f.request(f.panel, command)).toEqual({
				_tag: "rejected",
				reason: "unauthorized",
			});
		expect((await f.request(f.manager, commands[0]))._tag).toBe("success");
		const saved = await f.request(f.manager, {
			type: "save",
			token: target.token,
		});
		expect(
			saved._tag === "success" &&
				saved.envelope?.profiles[0].pages[0].keys[0]?.keyCode,
		).toBe("2,8");
		const added = await f.request(f.manager, {
			type: "add-page",
			profileId: "p",
			pageId: "two",
			revision: 1,
			deviceId: "device",
		});
		expect(
			added._tag === "success" && added.envelope?.activeByDevice.device?.pageId,
		).toBe("two");
		const removed = await f.request(f.manager, {
			type: "delete-page",
			profileId: "p",
			pageId: "two",
			revision: 2,
			deviceId: "device",
		});
		expect(
			removed._tag === "success" &&
				removed.envelope?.activeByDevice.device?.pageId,
		).toBe("one");
		expect(
			(
				await f.request(f.manager, {
					type: "delete-page",
					profileId: "p",
					pageId: "one",
					revision: 3,
					deviceId: "device",
				})
			)._tag,
		).toBe("rejected");
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("returns import diagnostics without writing, then imports quarantined JSON without runtime calls", async () => {
	let calls = 0;
	const f = fixture({}, () =>
		Effect.sync(() => {
			calls++;
		}),
	);
	try {
		const source = JSON.stringify([
			{
				...f.key,
				config: {
					...f.key.config,
					type: "cameraView",
					supportKnob: null,
					actions: [null, {}, { type: "", value: "" }],
				},
			},
		]);
		const inspected = await f.request(f.manager, {
			type: "inspect-import",
			source,
		});
		expect(
			inspected._tag === "success" && inspected.importReport?.profile,
		).toBeDefined();
		if (inspected._tag !== "success") throw new Error("Inspection rejected");
		expect(
			new Set(inspected.importReport?.diagnostics.map((d) => d.code)),
		).toEqual(
			new Set(["unknown-function", "missing-optional", "legacy-sentinel"]),
		);
		const before = await f.request(f.manager, { type: "read", locale: "en" });
		expect(before._tag === "success" && before.envelope?.profiles.length).toBe(
			2,
		);
		const imported = await f.request(f.manager, {
			type: "import-profile",
			source,
		});
		expect(
			imported._tag === "success" && imported.envelope?.profiles.length,
		).toBe(3);
		if (imported._tag !== "success") throw new Error("Import rejected");
		const p = imported.envelope?.profiles.find(
			(p) => p.id === imported.importedProfileId,
		);
		expect(p?.pages[0].keys[0]?.compatibility?.unsupported).toBe(true);
		expect(p?.pages[0].keys[0]?.compatibility?.source).toEqual(
			JSON.parse(source)[0],
		);
		expect(calls).toBe(0);
		expect(
			(
				await f.request(f.manager, {
					type: "import-profile",
					source: "{invalid",
				})
			)._tag,
		).toBe("rejected");
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

const integrationImports = [
	{
		type: "homeAssistant",
		childrenName: "homeAssistant",
		actions: [
			{
				type: "configData",
				value: JSON.stringify({
					entity_id: "light.test",
					service: "light.toggle",
					service_data: {},
					custom_display_type: "default",
					custom_display_settings: { fontSize: 20 },
					custom_display_detail: [],
				}),
			},
		],
	},
	{
		type: "clawbot",
		childrenName: "clawbot",
		actions: [{ type: "agentId", value: "test-agent" }],
	},
	{
		type: "quakeBot",
		childrenName: "ClawBotView",
		actions: [{ type: "agentId", value: "test-agent" }],
	},
	{ type: "quakeBotInput", childrenName: "ClawBotInput", actions: [] },
	{ type: "futureIntegration", childrenName: "futureIntegration", actions: [] },
];
it.each(integrationImports)(
	"imports $type through IPC and retains only supported keys in dispatch",
	async (entry) => {
		const dispatched: string[] = [];
		const f = fixture(
			{},
			() => Effect.void,
			(key) =>
				Effect.sync(() => {
					dispatched.push(key.config.type);
					return true;
				}),
		);
		const unknown = entry.type === "futureIntegration";
		try {
			const source = JSON.stringify([
				{
					...f.key,
					childrenName: entry.childrenName,
					config: { ...f.key.config, type: entry.type, actions: entry.actions },
				},
			]);
			const inspected = await f.request(f.manager, {
				type: "inspect-import",
				source,
			});
			expect(inspected._tag).toBe("success");
			if (inspected._tag !== "success") throw new Error("Inspection rejected");
			expect(
				inspected.importReport?.profile?.pages[0].keys[0]?.compatibility
					?.unsupported,
			).toBe(unknown);
			expect(
				inspected.importReport?.diagnostics.some(
					(d) => d.code === "unknown-function",
				),
			).toBe(unknown);
			const imported = await f.request(f.manager, {
				type: "import-profile",
				source,
			});
			if (
				imported._tag !== "success" ||
				!imported.envelope ||
				!imported.importedProfileId
			)
				throw new Error("Import rejected");
			const profile = imported.envelope.profiles.find(
				(p) => p.id === imported.importedProfileId,
			);
			expect(profile?.pages[0].keys[0]?.compatibility?.unsupported).toBe(
				unknown,
			);
			const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
				imported.envelope,
			);
			const projected = await Effect.runPromise(
				ProfileFunctionContracts.dispatchSnapshot(envelope).pipe(
					Effect.provide(ManagementProfileContractsLive),
				),
			);
			expect(
				projected.profiles
					.find((p) => p.id === imported.importedProfileId)
					?.pages[0].keys.map((k) => k.config.type),
			).toEqual(unknown ? [] : [entry.type]);
			// Home Assistant uses KeyRuntime; agent keys consume the dispatch snapshot in their own runtime.
			if (entry.type === "homeAssistant" || unknown) {
				await f.request(f.manager, {
					type: "select",
					deviceId: "device",
					profileId: imported.importedProfileId,
					pageId: profile?.pages[0].id,
				});
				await f.request(f.panel, {
					...f.activation,
					profileId: imported.importedProfileId,
					pageId: profile?.pages[0].id,
				});
				await f.runtime.runPromise(KeyRuntime.reset("device"));
				expect(dispatched).toEqual(unknown ? [] : [entry.type]);
			}
			if (!unknown) {
				const invalid = await f.request(f.manager, {
					type: "inspect-import",
					source: JSON.stringify([
						{ ...JSON.parse(source)[0], childrenName: "wrong-renderer" },
					]),
				});
				expect(
					invalid._tag === "success" &&
						invalid.importReport?.profile?.pages[0].keys[0]?.compatibility
							?.unsupported,
				).toBe(true);
				expect(
					invalid._tag === "success" &&
						invalid.importReport?.diagnostics.some(
							(d) => d.code === "invalid-action",
						),
				).toBe(true);
				const invalidConfig = await f.request(f.manager, {
					type: "inspect-import",
					source: JSON.stringify([
						{
							...JSON.parse(source)[0],
							config: {
								...f.key.config,
								type: entry.type,
								actions:
									entry.type === "quakeBotInput"
										? [{ type: "unexpected", value: "x" }]
										: [],
							},
						},
					]),
				});
				expect(
					invalidConfig._tag === "success" &&
						invalidConfig.importReport?.profile?.pages[0].keys[0]?.compatibility
							?.unsupported,
				).toBe(true);
				expect(
					invalidConfig._tag === "success" &&
						invalidConfig.importReport?.diagnostics.some(
							(d) => d.code === "invalid-action",
						),
				).toBe(true);
			}
		} finally {
			await f.registration.dispose();
			await f.runtime.dispose();
		}
	},
);

it("restricts the owned picker to icon operations and returns pixels without editing the draft", async () => {
	const f = fixture();
	try {
		const pending = f.request(f.manager, {
			type: "open-icons",
			token: "picker-a",
			locale: "de",
		});
		const child = BrowserWindow.getAllWindows().at(-1);
		if (!child) throw new Error("Missing picker");
		expect(child).not.toBe(f.impostor);
		for (const command of [
			f.activation,
			{ type: "select", deviceId: "device", profileId: "q", pageId: "one" },
			{
				type: "preview",
				target: {
					token: "foreign",
					profileId: "p",
					pageId: "one",
					keyCode: "1,1",
					revision: 0,
				},
				key: f.key,
			},
		])
			expect(await f.request(child, command)).toEqual({
				_tag: "rejected",
				reason: "unauthorized",
			});
		expect((await f.request(child, { type: "icons" }))._tag).toBe("success");
		expect((await f.request(child, { type: "icons" }, {}))._tag).toBe(
			"rejected",
		);
		const data = "data:image/png;base64,AAAA";
		expect(
			(await f.request(child, { type: "pick-icon", token: "wrong", data }))
				._tag,
		).toBe("rejected");
		expect(
			(
				await f.request(child, {
					type: "pick-icon",
					token: "picker-a",
					data: "data:image/svg+xml,<svg/>",
				})
			)._tag,
		).toBe("rejected");
		expect(
			(
				await f.request(child, {
					type: "pick-icon",
					token: "picker-a",
					data,
					source: "library-reference",
				})
			)._tag,
		).toBe("success");
		expect(await pending).toEqual({
			_tag: "success",
			icon: data,
			iconSource: "library-reference",
		});
		expect(child.isDestroyed()).toBe(true);
		const read = await f.request(f.manager, { type: "read", locale: "en" });
		expect(
			read._tag === "success" &&
				read.envelope?.profiles[0]?.pages[0]?.keys[0]?.config.icon,
		).toBe(f.key.config.icon);
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("ignores stale picker cancellation and settles open requests during disposal", async () => {
	const f = fixture();
	try {
		const first = f.request(f.manager, {
			type: "open-icons",
			token: "old",
			locale: "en",
		});
		const old = BrowserWindow.getAllWindows().at(-1);
		const second = f.request(f.manager, {
			type: "open-icons",
			token: "new",
			locale: "en",
		});
		const current = BrowserWindow.getAllWindows().at(-1);
		if (!old || !current) throw new Error("Missing picker");
		expect(await first).toEqual({ _tag: "success" });
		expect(old.isDestroyed()).toBe(true);
		await f.request(f.manager, { type: "cancel-icons", token: "old" });
		expect(current.isDestroyed()).toBe(false);
		vi.spyOn(f.impostor.webContents, "getURL").mockReturnValue(
			current.webContents.getURL(),
		);
		expect((await f.request(f.impostor, { type: "icons" }))._tag).toBe(
			"rejected",
		);
		await f.registration.dispose();
		expect(await second).toEqual({ _tag: "success" });
		expect(current.isDestroyed()).toBe(true);
	} finally {
		await f.runtime.dispose();
	}
});

it("rejects a delayed import after the owning picker closes", async () => {
	const files = await importFixture();
	const f = fixture();
	let release = () => {};
	electron.dialog.showOpenDialog.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = () =>
					resolve({ canceled: false, filePaths: [files.localPath] });
			}),
	);
	try {
		const opened = f.request(f.manager, {
			type: "open-icons",
			token: "closing",
			locale: "en",
		});
		const child = BrowserWindow.getAllWindows().at(-1);
		if (!child) throw new Error("Missing picker");
		const importing = f.request(child, { type: "import-icon" });
		await vi.waitFor(() =>
			expect(electron.dialog.showOpenDialog).toHaveBeenCalledOnce(),
		);
		await f.request(f.manager, { type: "cancel-icons", token: "closing" });
		await opened;
		release();
		expect((await importing)._tag).toBe("rejected");
		expect(await f.request(f.manager, { type: "icons" })).toMatchObject({
			_tag: "success",
			packs: [],
		});
	} finally {
		release();
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});
it("saves only profile knob data through management IPC and rejects panel, foreign frame and stale revision", async () => {
	const f = fixture();
	try {
		const before = await f.runtime.runPromise(ProfileService.getProfile("p"));
		const knob = {
			keyCode: "0,1",
			config: {
				type: "knob",
				title: {
					text: "Knob",
					pos: "bot",
					size: 8,
					color: "#FFFFFF",
					display: true,
					style: "",
				},
				icon: "",
				size: [1, 1],
				display: true,
				subActions: Array.from({ length: 3 }, () => ({
					childrenName: "",
					config: { type: "", actions: [] },
				})),
			},
		};
		const command = { type: "save-knob", profileId: "p", revision: 0, knob };
		for (const reply of [
			await f.request(f.panel, command),
			await f.request(f.impostor, command),
			await f.request(f.manager, command, {}),
		])
			expect(reply._tag).toBe("rejected");
		const saved = await f.request(f.manager, command);
		expect(saved._tag).toBe("success");
		const after = await f.runtime.runPromise(ProfileService.getProfile("p"));
		expect(after.pages).toEqual(before.pages);
		expect(after.name).toBe(before.name);
		expect(after.revision).toBe(1);
		expect((await f.request(f.manager, command))._tag).toBe("rejected");
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("refuses knob saves without stranding an unsaved key draft", async () => {
	const f = fixture();
	try {
		const profile = await f.runtime.runPromise(ProfileService.getProfile("p"));
		const original = profile.pages[0]?.keys[0];
		if (!original) throw new Error("Missing fixture key");
		const key = Schema.encodeSync(ProfileKey)({
			...original,
			config: {
				...original.config,
				title: { ...original.config.title, text: "Unsaved title" },
				userModifiedTitle: true,
			},
		});
		const target = {
			token: "draft",
			profileId: "p",
			pageId: "one",
			keyCode: "1,1",
			revision: 0,
		};
		expect(
			(await f.request(f.manager, { type: "preview", target, key }))._tag,
		).toBe("success");
		const knob = emptyKnobResource();
		const blocked = await f.request(f.manager, {
			type: "save-knob",
			profileId: "p",
			revision: 0,
			knob,
		});
		expect(blocked).toEqual({
			_tag: "rejected",
			reason:
				"Save or cancel the selected key edit before saving knob settings.",
		});
		expect(
			(await f.runtime.runPromise(ProfileService.getProfile("p"))).revision,
		).toBe(0);
		expect(
			(await f.request(f.manager, { type: "preview", target, key }))._tag,
		).toBe("success");
		expect(
			(await f.request(f.manager, { type: "save", token: "draft" }))._tag,
		).toBe("success");
		const saved = await f.runtime.runPromise(ProfileService.getProfile("p"));
		expect(saved.pages[0]?.keys[0]?.config.title.text).toBe("Unsaved title");
		expect(saved.revision).toBe(1);
		expect(
			(
				await f.request(f.manager, {
					type: "save-knob",
					profileId: "p",
					revision: 1,
					knob,
				})
			)._tag,
		).toBe("success");
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

function fixture(
	config: Readonly<Record<string, unknown>> = {},
	execute: () => Effect.Effect<void> = () => Effect.void,
	executeOwned?: (key: ProfileKey) => Effect.Effect<boolean>,
	extraKeys: readonly ProfileKey[] = [],
) {
	let pause: Promise<void> | undefined;
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = {
		...empty,
		childrenName: typeof config.type === "string" ? config.type : "timer",
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
			{
				id: "p",
				name: "P",
				revision: 0,
				pages: [
					{
						id: "one",
						keys: [
							key,
							...extraKeys.map((item) => Schema.encodeSync(ProfileKey)(item)),
						],
					},
				],
			},
			{ id: "q", name: "Q", revision: 0, pages: [{ id: "one", keys: [] }] },
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	};
	const published: { countdown?: number; profileId: string }[] = [];
	const profiles = ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(ManagementProfileContractsLive),
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
							...(executeOwned ? { executeOwned } : {}),
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
	const request = (
		win: BrowserWindow,
		input: unknown,
		frame: object = win.webContents.mainFrame,
	) => handler({ sender: win.webContents, senderFrame: frame }, input);
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
		openPicker: () => {
			void request(manager, {
				type: "open-icons",
				token: `fixture-${electron.nextId()}`,
				locale: "en",
			});
			const child = BrowserWindow.getAllWindows().at(-1);
			if (!child) throw new Error("Missing picker");
			return child;
		},
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
		const installed = await f.request(f.openPicker(), { type: "import-pack" });
		if (installed._tag !== "success" || !installed.packs?.[0])
			throw new Error("Pack import failed");
		const pack = installed.packs[0],
			id = pack.icons[0]?.id;
		assertId(id);
		expect(
			await f.request(f.openPicker(), { type: "remove-icon", id }),
		).toMatchObject({ _tag: "rejected" });
		electron.dialog.showOpenDialog.mockResolvedValue({
			canceled: false,
			filePaths: [files.localPath],
		});
		const local = await f.request(f.openPicker(), { type: "import-icon" });
		if (local._tag !== "success") throw new Error("Local import failed");
		expect(local.packs?.find((p) => p.id === "local")?.icons[0]?.id).toBe(id);
		const removed = await f.request(f.openPicker(), {
			type: "remove-icon",
			id,
		});
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
		expect(
			await f.request(f.openPicker(), { type: "import-pack" }),
		).toMatchObject({
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
		const imported = await f.request(f.openPicker(), { type: "import-icon" });
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
			await f.request(f.openPicker(), { type: "remove-icon", id: icon.id }),
		).toMatchObject({
			_tag: "rejected",
			reason: "This icon is currently in use and cannot be deleted.",
		});
		expect(
			await f.request(f.manager, { type: "save", token: target.token }),
		).toMatchObject({ _tag: "success" });
		expect(
			await f.request(f.openPicker(), { type: "remove-icon", id: icon.id }),
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
		importing = f.request(f.openPicker(), { type: "import-icon" });
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
		const importing = f.request(f.openPicker(), { type: "import-icon" });
		let disposing: Promise<void> | undefined;
		try {
			await entered.promise;
			if (mode === "navigation") {
				vi.spyOn(f.manager.webContents, "getURL").mockReturnValue(
					"https://foreign.invalid",
				);
				f.manager.webContents.emit(
					"did-start-navigation",
					{},
					"https://foreign.invalid",
					false,
					true,
				);
			} else disposing = f.registration.dispose();
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

it("keeps panel activation and navigation responsive while app artwork is pending and rejects a closed picker's result", async () => {
	const entered = barrier<void>(),
		scan = barrier<{ id: string; name: string; icons: [] }>();
	appIcons.load.mockImplementation(() => {
		entered.resolve();
		return scan.promise;
	});
	let calls = 0;
	const f = fixture(
		{ type: "hotkey", actions: [{ type: "key", value: "a" }] },
		() =>
			Effect.sync(() => {
				calls++;
			}),
	);
	let scanning: Promise<KeyReply> | undefined;
	try {
		const opened = f.request(f.manager, {
			type: "open-icons",
			token: "scan",
			locale: "en",
		});
		const child = BrowserWindow.getAllWindows().at(-1);
		if (!child) throw new Error("Missing picker");
		scanning = f.request(child, { type: "application-icons" });
		await entered.promise;
		expect(
			await Promise.race([
				f.request(f.panel, f.activation),
				new Promise((resolve) => setTimeout(() => resolve("blocked"), 400)),
			]),
		).toEqual({ _tag: "success" });
		await vi.waitFor(() => expect(calls).toBe(1));
		expect(
			await Promise.race([
				f.request(f.panel, {
					type: "navigate",
					deviceId: "device",
					direction: 1,
				}),
				new Promise((resolve) => setTimeout(() => resolve("blocked"), 400)),
			]),
		).toEqual({ _tag: "success" });
		await f.request(f.manager, { type: "cancel-icons", token: "scan" });
		await opened;
		scan.resolve({ id: "applications", name: "Applications", icons: [] });
		expect(await scanning).toEqual({
			_tag: "rejected",
			reason: "unauthorized",
		});
	} finally {
		scan.resolve({ id: "applications", name: "Applications", icons: [] });
		await scanning;
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});
it("rejects management icon storage mutations with and without an owned picker", async () => {
	const f = fixture();
	try {
		for (const open of [false, true]) {
			if (open)
				void f.request(f.manager, {
					type: "open-icons",
					token: "mutations",
					locale: "en",
				});
			for (const type of [
				"import-pack",
				"import-icon",
				"remove-pack",
				"remove-icon",
			]) {
				const command = type.startsWith("remove")
					? { type, id: "missing" }
					: { type };
				expect(await f.request(f.manager, command)).toEqual({
					_tag: "rejected",
					reason: "unauthorized",
				});
			}
		}
		expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("keeps live input and timer cancellation responsive during a stalled HA request and interrupts it on reset", async () => {
	const entered = barrier<void>(),
		response = barrier<void>(),
		shortcut = barrier<void>();
	let integrations = 0,
		shortcuts = 0,
		interrupted = false;
	const makeKey = (
		keyCode: string,
		config: Readonly<Record<string, unknown>>,
	) =>
		Schema.decodeUnknownSync(ProfileKey)({
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey(keyCode)),
			childrenName: config.type,
			config: {
				...Schema.encodeSync(ProfileKey)(createEmptyProfileKey(keyCode)).config,
				...config,
			},
		});
	const f = fixture(
		{ type: "homeAssistant" },
		() =>
			Effect.sync(() => {
				shortcuts++;
				shortcut.resolve();
			}),
		() =>
			Effect.sync(() => {
				integrations++;
				entered.resolve();
			}).pipe(
				Effect.zipRight(Effect.promise(() => response.promise)),
				Effect.as(true),
				Effect.onInterrupt(() =>
					Effect.sync(() => {
						interrupted = true;
					}),
				),
			),
		[
			makeKey("1,2", {
				type: "hotkey",
				display: true,
				actions: [{ type: "key", value: "a" }],
			}),
			makeKey("1,3", {
				type: "timer",
				display: true,
				actions: [{ type: "time", value: 60000 }],
			}),
		],
	);
	const bounded = <A>(work: Promise<A>) =>
		Promise.race([
			work,
			new Promise<string>((resolve) =>
				setTimeout(() => resolve("blocked by HA"), 1000),
			),
		]);
	let pending: Promise<unknown> | undefined;
	const dispatcher = createPanelKeyDispatcher(
		() => ({ deviceId: "device", profileId: "p", pageId: "one", revision: 0 }),
		(command) => {
			const operation = f.request(f.panel, command);
			if (
				command.type === "activate" &&
				command.keyCode === "1,1" &&
				command.kind === "press"
			)
				pending = operation.catch(() => "interrupted");
			return operation;
		},
	);
	const tap = (keyCode: string) => {
		dispatcher.key({ keyCode, keyAction: 0 });
		dispatcher.key({ keyCode, keyAction: 1 });
	};
	try {
		const timer = { ...f.activation, keyCode: "1,3" };
		await f.request(f.panel, timer);
		await f.request(f.panel, { ...timer, kind: "release" });
		tap("1,1");
		await entered.promise;
		expect(await bounded(f.request(f.panel, f.activation))).toEqual({
			_tag: "success",
		});
		expect(integrations).toBe(1);
		expect(
			await bounded(f.request(f.panel, { ...f.activation, kind: "release" })),
		).toEqual({ _tag: "success" });
		tap("1,2");
		expect(await bounded(shortcut.promise)).toBeUndefined();
		expect(shortcuts).toBe(1);
		tap("1,3");
		await vi.waitFor(async () => {
			const states = await f.runtime.runPromise(KeyRuntime.snapshot);
			expect(states.find((value) => value.keyCode === "1,3")).toMatchObject({
				countdown: -1,
				alert: 0,
			});
		});
		expect(
			await bounded(
				f.request(f.panel, {
					type: "navigate",
					deviceId: "device",
					direction: 1,
				}),
			),
		).toEqual({ _tag: "success" });
		expect(
			await bounded(f.runtime.runPromise(KeyRuntime.reset("device"))),
		).toBeUndefined();
		expect(interrupted).toBe(true);
		if (!pending)
			throw new Error("Panel did not dispatch the Home Assistant press");
		expect(await bounded(pending)).toBe("interrupted");
	} finally {
		dispatcher.cancel();
		response.resolve();
		await pending;
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("redacts clock media in editor replies and previews without losing it on save", async () => {
	const path = "/Users/private/clock-media.png";
	const f = fixture({
		type: "dkDesktopClock",
		actions: [
			{
				type: "clockStyle",
				value: {
					background: {
						mode: "theme",
						themeId: "season",
						themes: { season: { kind: "image", path } },
					},
				},
			},
		],
	});
	try {
		const read = await f.request(f.manager, { type: "read", locale: "en" });
		if (read._tag !== "success" || !read.envelope)
			throw new Error("Read fixture failed");
		expect(JSON.stringify(read)).not.toContain(path);
		const key = read.envelope.profiles[0].pages[0].keys[0];
		const target = {
			token: "clock-media-roundtrip",
			profileId: "p",
			pageId: "one",
			keyCode: "1,1",
			revision: 0,
		};
		const preview = await f.request(f.manager, {
			type: "preview",
			target,
			key,
		});
		expect(preview._tag).toBe("success");
		expect(JSON.stringify(preview)).not.toContain(path);
		expect(
			JSON.stringify(vi.mocked(f.manager.webContents.send).mock.calls),
		).not.toContain(path);
		const saved = await f.request(f.manager, {
			type: "save",
			token: target.token,
		});
		expect(saved._tag).toBe("success");
		expect(JSON.stringify(saved)).not.toContain(path);
		const main = await f.runtime.runPromise(ProfileService.loadProfiles());
		expect(JSON.stringify(main.envelope)).toContain(path);
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("redacts clock media paths from imported profile replies", async () => {
	const path = "/Users/private/imported-clock.png";
	const f = fixture({
		type: "dkDesktopClock",
		actions: [
			{
				type: "clockStyle",
				value: {
					background: {
						mode: "theme",
						themeId: "season",
						themes: { season: { kind: "image", path } },
					},
				},
			},
		],
	});
	try {
		const imported = await f.request(f.manager, {
			type: "import-profile",
			source: JSON.stringify([f.key]),
		});
		if (imported._tag !== "success") throw new Error("Import rejected");
		expect(imported.importedProfileId).toBeDefined();
		expect(JSON.stringify(imported)).not.toContain(path);
		const main = await f.runtime.runPromise(ProfileService.loadProfiles());
		const stored = main.envelope.profiles.find(
			(p) => p.id === imported.importedProfileId,
		);
		expect(JSON.stringify(stored)).toContain(path);
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it("binds target and locale before readiness, ignores late readiness and starts fresh on reopen", async () => {
	const f = fixture();
	try {
		const first = f.request(f.manager, {
			type: "open-icons",
			token: "before-ready",
			locale: "de",
		});
		const child = BrowserWindow.getAllWindows().at(-1);
		if (!child) throw new Error("Missing picker");
		const url = new URL(child.webContents.getURL());
		expect(url.searchParams.get("token")).toBe("before-ready");
		expect(url.searchParams.get("locale")).toBe("de");
		if (!("options" in child)) throw new Error("Missing synthetic options");
		expect(child.options).toMatchObject({
			width: 600,
			height: 550,
			minWidth: 600,
			minHeight: 550,
			resizable: true,
			show: false,
		});
		await f.request(f.manager, { type: "cancel-icons", token: "before-ready" });
		child.emit("ready-to-show");
		expect(child.show).not.toHaveBeenCalled();
		expect(child.showInactive).not.toHaveBeenCalled();
		expect(await first).toEqual({ _tag: "success" });
		const second = f.request(f.manager, {
			type: "open-icons",
			token: "reopen",
			locale: "en",
		});
		const reopened = BrowserWindow.getAllWindows().at(-1);
		expect(reopened).not.toBe(child);
		expect(
			new URL(reopened?.webContents.getURL() ?? "about:blank").searchParams.get(
				"token",
			),
		).toBe("reopen");
		await f.registration.dispose();
		expect(await second).toEqual({ _tag: "success" });
	} finally {
		await f.runtime.dispose();
	}
});

it("never sends installed application paths to the panel catalog consumer", async () => {
	const f = fixture();
	appIcons.load.mockResolvedValue({
		id: "applications",
		name: "Apps",
		icons: [
			{
				id: "a".repeat(64),
				name: "Private",
				tags: [],
				extraData: ["/Users/private/Secret.app"],
				data: "data:image/png;base64,AAAA",
			},
		],
	});
	try {
		const reply = await f.request(f.panel, { type: "application-icons" });
		expect(reply._tag).toBe("success");
		expect(JSON.stringify(reply)).not.toContain("/Users/private");
		expect(reply).toMatchObject({
			packs: [
				{ icons: [{ id: "a".repeat(64), data: "data:image/png;base64,AAAA" }] },
			],
		});
	} finally {
		await f.registration.dispose();
		await f.runtime.dispose();
	}
});

it.each([
	{ pack: false, saved: false },
	{ pack: false, saved: true },
	{ pack: true, saved: false },
	{ pack: true, saved: true },
])(
	"protects application-prefixed artwork from deletion: %j",
	async ({ pack, saved }) => {
		const files = await importFixture(),
			f = fixture();
		try {
			electron.dialog.showOpenDialog.mockResolvedValue({
				canceled: false,
				filePaths: [pack ? files.packPath : files.localPath],
			});
			const imported = await f.request(f.openPicker(), {
				type: pack ? "import-pack" : "import-icon",
			});
			if (imported._tag !== "success") throw new Error("Import failed");
			const library = imported.packs?.find((p) =>
					pack ? p.id !== "local" : p.id === "local",
				),
				icon = library?.icons[0];
			if (!library || !icon) throw new Error("Missing artwork");
			const target = {
				token: "application-reference",
				profileId: "p",
				pageId: "one",
				keyCode: "1,1",
				revision: 0,
			};
			const key = {
				...f.key,
				config: { ...f.key.config, icon: `application:${icon.id}` },
			};
			expect(
				await f.request(f.manager, { type: "preview", target, key }),
			).toMatchObject({ _tag: "success" });
			if (saved)
				expect(
					await f.request(f.manager, { type: "save", token: target.token }),
				).toMatchObject({ _tag: "success" });
			expect(
				await f.request(f.openPicker(), {
					type: pack ? "remove-pack" : "remove-icon",
					id: pack ? library.id : icon.id,
				}),
			).toMatchObject({
				_tag: "rejected",
				reason: "This icon is currently in use and cannot be deleted.",
			});
			expect(await f.request(f.manager, { type: "icons" })).toMatchObject({
				packs: [
					expect.objectContaining({
						id: library.id,
						icons: expect.arrayContaining([icon]),
					}),
				],
			});
		} finally {
			await f.registration.dispose();
			await f.runtime.dispose();
		}
	},
);

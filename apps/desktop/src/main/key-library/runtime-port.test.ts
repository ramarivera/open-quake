import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	Schema,
	TestClock,
	TestContext,
} from "effect";
import { afterEach, expect, it, vi } from "vitest";
import type { MediaActionAdapter } from "../../../../../packages/device/src/actions/action-adapters.js";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors.js";
import { normalizeActionImport } from "../../../../../packages/device/src/actions/action-import.js";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service.js";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { makeAudioOutput } from "../../../../../packages/edge/src/audio/output-service.js";
import { systemMediaKeyActions } from "../weather-media/key-actions";
import {
	captureScreenshots,
	lockWorkstation,
	nativeApplicationPort,
} from "./native-host";
import {
	type DesktopKeyRuntimeActions,
	desktopKeyRuntimePort,
} from "./runtime-port";

const files = vi.hoisted(() => ({
	stat: vi.fn(),
	access: vi.fn(),
	readFile: vi.fn(),
	open: vi.fn(),
	readdir: vi.fn(),
	opendir: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:fs/promises")>()),
	...files,
}));
const os = vi.hoisted(() => ({
	platform: vi.fn(() => "darwin"),
	openPath: vi.fn(async (_path: string) => ""),
	openExternal: vi.fn(async (_url: string) => {}),
	exec: vi.fn<(file: string, args: readonly string[]) => void>(),
	clipboard: vi.fn<() => string[]>(() => ["text/plain"]),
	readText: vi.fn(() => "before"),
	readHTML: vi.fn(() => "<b>before</b>"),
	readRTF: vi.fn(() => "rich"),
	readImage: vi.fn(() => ({})),
	clear: vi.fn(),
	writeText: vi.fn(),
	write: vi.fn(),
	worker: vi.fn(),
}));
vi.mock("node:os", () => ({ platform: os.platform }));
vi.mock("node:child_process", () => ({
	execFile: (
		file: string,
		args: readonly string[],
		callback: (error: unknown, stdout: string, stderr: string) => void,
	) => {
		try {
			os.exec(file, args);
			callback(null, "", "");
		} catch (cause) {
			callback(cause, "", "");
		}
	},
}));
vi.mock("electron", () => ({
	BrowserWindow: os.worker,
	shell: { openPath: os.openPath, openExternal: os.openExternal },
	clipboard: {
		availableFormats: os.clipboard,
		readText: os.readText,
		readHTML: os.readHTML,
		readRTF: os.readRTF,
		readImage: os.readImage,
		clear: os.clear,
		writeText: os.writeText,
		write: os.write,
	},
}));
afterEach(() => {
	vi.clearAllMocks();
	os.platform.mockReturnValue("darwin");
	os.openPath.mockResolvedValue("");
	os.exec.mockReset();
	os.clipboard.mockReturnValue(["text/plain"]);
	os.readText.mockReturnValue("before");
	os.writeText.mockReset();
});
const open = (value: string) => ({
	type: "open" as const,
	actions: [{ type: "path" as const, value }] as const,
});
function layer(
	mock = false,
	publish: KeyRuntimePort["Type"]["publish"] = () => Effect.void,
	media?: MediaActionAdapter,
	savedKey?: typeof ProfileKey.Encoded,
	owned?: (key: ProfileKey, signal: AbortSignal) => Promise<boolean>,
	hardware: () => HardwareSession | undefined = () => undefined,
	runtimeActions: DesktopKeyRuntimeActions = {},
) {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const profiles = ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provide(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => ({
							schemaVersion: 1,
							profiles: [
								{
									id: "p",
									name: "Synthetic",
									revision: 0,
									pages: [
										{
											id: "one",
											keys: [
												savedKey ?? {
													...empty,
													childrenName: "multiActions",
													config: {
														...empty.config,
														type: "multiActions",
														display: true,
														subActions: [
															open("app:org.example.Editor"),
															open("/Applications/Example.app"),
														].map((config) => ({
															config: { ...config, gap: 0 },
														})),
													},
												},
											],
										},
									],
								},
							],
							activeByDevice: { device: { profileId: "p", pageId: "one" } },
						}),
						write: async () => {},
					}),
				),
			),
		),
	);
	const port = desktopKeyRuntimePort(
		hardware,
		(state) => Effect.runSync(publish(state)),
		mock,
		owned,
		media,
		undefined,
		{
			application: {
				launch: nativeApplicationPort.launch,
				focus: nativeApplicationPort.focus,
				terminate: nativeApplicationPort.terminate,
				list: async () => [],
				identity: async () => undefined,
			},
			...runtimeActions,
		},
	).pipe(Layer.provide(profiles));
	return KeyRuntime.DefaultWithoutDependencies.pipe(Layer.provideMerge(port));
}
it("resolves bundle references with structured macOS argv and keeps filesystem paths", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const port = yield* KeyRuntimePort;
			yield* port.execute(open("app:org.example.Editor"));
			yield* port.execute(open("APP:org.example.Other"));
			yield* port.execute(open("/Applications/Example App.app"));
		}).pipe(Effect.provide(layer()), Effect.scoped),
	);
	expect(os.exec.mock.calls).toEqual([
		["/usr/bin/open", ["-b", "org.example.Editor"]],
		["/usr/bin/open", ["-b", "org.example.Other"]],
	]);
	expect(os.openPath.mock.calls).toEqual([["/Applications/Example App.app"]]);
});
it.each([
	["linux", "/opt/synthetic/example"],
	["win32", "C:\\Synthetic App\\example.exe"],
])("keeps absolute path launch on %s", async (platform, path) => {
	os.platform.mockReturnValue(platform);
	await Effect.runPromise(
		Effect.gen(function* () {
			const port = yield* KeyRuntimePort;
			yield* port.execute(open(path));
		}).pipe(Effect.provide(layer()), Effect.scoped),
	);
	expect(os.openPath.mock.calls).toEqual([[path]]);
	expect(os.exec).not.toHaveBeenCalled();
});
it.each(["linux", "win32"])(
	"rejects bundle references on %s without OS effects",
	async (platform) => {
		os.platform.mockReturnValue(platform);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const port = yield* KeyRuntimePort;
				return yield* Effect.either(
					port.execute(open("app:org.example.Editor")),
				);
			}).pipe(Effect.provide(layer()), Effect.scoped),
		);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left).toMatchObject({
				_tag: "HostActionFailed",
				code: "QUAKE.ACTION.HOST_FAILED",
			});
			expect(result.left).toBeInstanceOf(HostActionFailed);
		}
		expect(os.exec).not.toHaveBeenCalled();
		expect(os.openPath).not.toHaveBeenCalled();
	},
);
it.each(["bundle", "path"])(
	"preserves %s boundary failure identity and scrubs serialization",
	async (kind) => {
		const cause = Object.assign(
			new Error("private /Users/synthetic/token=secret"),
			{ code: "ENOENT" },
		);
		if (kind === "bundle")
			os.exec.mockImplementation(() => {
				throw cause;
			});
		else os.openPath.mockRejectedValue(cause);
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const port = yield* KeyRuntimePort;
				return yield* Effect.either(
					port.execute(
						open(
							kind === "bundle"
								? "app:org.example.Missing"
								: "/synthetic/Missing.app",
						),
					),
				);
			}).pipe(Effect.provide(layer()), Effect.scoped),
		);
		expect(result._tag).toBe("Left");
		if (result._tag === "Left" && result.left instanceof HostActionFailed) {
			expect(result.left.code).toBe("QUAKE.ACTION.HOST_FAILED");
			expect(result.left.originalCause).toBe(cause);
			expect(result.left.diagnosticCause.sourceCode).toBe("ENOENT");
			expect(JSON.stringify(result.left)).not.toMatch(
				/private|synthetic|secret/,
			);
		} else throw new Error("Expected HostActionFailed");
	},
);
it("turns openPath error results into tagged host failures", async () => {
	os.openPath.mockResolvedValue("synthetic launch failure");
	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const port = yield* KeyRuntimePort;
			return yield* Effect.either(port.execute(open("/synthetic/Missing.app")));
		}).pipe(Effect.provide(layer()), Effect.scoped),
	);
	expect(result).toMatchObject({
		_tag: "Left",
		left: { _tag: "HostActionFailed", code: "QUAKE.ACTION.HOST_FAILED" },
	});
});
it.each([false, true])(
	"runs the real sequence consumer, mock=%s",
	async (mock) => {
		await Effect.runPromise(
			Effect.gen(function* () {
				const done = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					yield* KeyRuntime.activate("device", "1,1", "press");
					yield* Deferred.await(done).pipe(Effect.timeout("2 seconds"));
				}).pipe(
					Effect.provide(
						layer(mock, (state) =>
							state.progress === 100
								? Deferred.succeed(done, undefined).pipe(Effect.asVoid)
								: Effect.void,
						),
					),
				);
			}).pipe(Effect.scoped),
		);
		expect(os.exec.mock.calls).toEqual(
			mock ? [] : [["/usr/bin/open", ["-b", "org.example.Editor"]]],
		);
		expect(os.openPath.mock.calls).toEqual(
			mock ? [] : [["/Applications/Example.app"]],
		);
		expect(os.clipboard).not.toHaveBeenCalled();
	},
);
it("stops the real sequence at the failed bundle launch and publishes failure", async () => {
	os.exec.mockImplementation(() => {
		throw Object.assign(new Error("synthetic missing bundle"), {
			code: "ENOENT",
		});
	});
	await Effect.runPromise(
		Effect.gen(function* () {
			const failed = yield* Deferred.make<void>();
			yield* Effect.gen(function* () {
				yield* KeyRuntime.activate("device", "1,1", "press");
				yield* Deferred.await(failed).pipe(Effect.timeout("2 seconds"));
			}).pipe(
				Effect.provide(
					layer(false, (state) =>
						state.progress === 100 && state.alert === 1
							? Deferred.succeed(failed, undefined).pipe(Effect.asVoid)
							: Effect.void,
					),
				),
			);
		}).pipe(Effect.scoped),
	);
	expect(os.exec).toHaveBeenCalledOnce();
	expect(os.openPath).not.toHaveBeenCalled();
});

it.each([false, true])(
	"ordinary media-key consumer uses the shared binding only in production, mock=%s",
	async (mock) => {
		const send = vi.fn(async () => ({ accepted: true }));
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const port = yield* KeyRuntimePort;
				return yield* Effect.either(
					port.execute({
						type: "playPause",
						actions: [{ type: "key", value: "audio_play" }],
					}),
				);
			}).pipe(
				Effect.provide(
					layer(mock, () => Effect.void, systemMediaKeyActions(send)),
				),
				Effect.scoped,
			),
		);
		expect(result._tag).toBe(mock ? "Left" : "Right");
		expect(send).toHaveBeenCalledTimes(mock ? 0 : 1);
		if (!mock)
			expect(send).toHaveBeenCalledWith("audio_play", expect.any(AbortSignal));
		expect(os.exec).not.toHaveBeenCalled();
	},
);

it.each([true, false])(
	"routes local sound on release only and preserves quarantine, quarantined=%s",
	async (quarantined) => {
		const builtin = builtinProfiles("darwin").find(
			(profile) => profile.id === "1-6",
		);
		if (!builtin) throw new Error("Missing built-in sound fixture");
		const first = builtin.pages[0].keys[0];
		if (!first) throw new Error("Missing sound key");
		const encoded = Schema.encodeSync(ProfileKey)(first);
		const raw = {
			...encoded,
			config: {
				...encoded.config,
				actions: [
					{ type: "sound", value: '["/private/local/track.mp3"]' },
					{ type: "audioAction", value: 1 },
					{ type: "audioFade", value: "3-500" },
					{ type: "volume", value: 50 },
				],
			},
		};
		const imported = normalizeActionImport(raw);
		expect(imported.diagnostics).toContain("unsupported-or-incomplete");
		const key = Schema.encodeSync(ProfileKey)(
			Schema.decodeUnknownSync(ProfileKey)({
				...raw,
				compatibility: {
					...raw.compatibility,
					unsupported: quarantined,
					source: imported.original,
				},
			}),
		);
		const owned = vi.fn(async (_key: ProfileKey, _signal: AbortSignal) => true);
		const media = {
			supportedCommands: new Set(["audio_play"] as const),
			sendMedia: vi.fn(() => Effect.void),
		};
		const publish = vi.fn(() => Effect.void);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const output = yield* makeAudioOutput;
					let speechStops = 0;
					const speech = yield* output.acquire(
						"speech",
						Effect.sync(() => {
							speechStops++;
						}),
					);
					const runtime = yield* KeyRuntime;
					const result = yield* runtime
						.activate("device", "1,1", "press")
						.pipe(Effect.either);
					expect(result._tag).toBe("Right");
					expect(owned).not.toHaveBeenCalled();
					expect(yield* speech.current).toBe(true);
					expect(speechStops).toBe(0);
					yield* runtime.activate("device", "1,1", "release");
					expect(os.exec).not.toHaveBeenCalled();
					expect(os.openPath).not.toHaveBeenCalled();
					expect(os.openExternal).not.toHaveBeenCalled();
					expect(os.clipboard).not.toHaveBeenCalled();
					expect(media.sendMedia).not.toHaveBeenCalled();
					expect(owned).toHaveBeenCalledTimes(quarantined ? 0 : 1);
					expect(publish).not.toHaveBeenCalled();
					expect(os.worker).not.toHaveBeenCalled();
					for (const probe of Object.values(files))
						expect(probe).not.toHaveBeenCalled();
					yield* speech.release;
					expect(speechStops).toBe(1);
				}),
			).pipe(Effect.provide(layer(false, publish, media, key, owned))),
		);
	},
);

it.each([false, true])(
	"MAIN-065 SCREEN-057 held HID edges release the original keyboard owner, lostAck=%s",
	async (lostAck) => {
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const fake = yield* makeFakeHardwareTransport({
						serial: "device",
						...(lostAck ? { onCommand: () => [] } : {}),
					});
					const device = yield* QuakeDevice.pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
					const controls = yield* HardwareControls.pipe(
						Effect.provide(HardwareControls.Default),
					);
					const session = yield* controls.create(yield* device.connect(), {
						serial: "device",
						session: "touch-1",
					});
					let active: HardwareSession | undefined = session;
					const empty = Schema.encodeSync(ProfileKey)(
						createEmptyProfileKey("1,1"),
					);
					const key = {
						...empty,
						childrenName: "hotkey",
						config: {
							...empty.config,
							type: "hotkey",
							display: true,
							actions: [{ type: "key", value: "control+a" }],
						},
					};
					yield* Effect.gen(function* () {
						const runtime = yield* KeyRuntime;
						if (lostAck) {
							const result = yield* Effect.either(
								runtime.activate("device", "1,1", "down"),
							);
							expect(result._tag).toBe("Left");
							if (result._tag === "Left")
								expect(result.left.code).toBe("QUAKE.ACTION.HOST_FAILED");
							expect(
								(yield* fake.writes)
									.filter((bytes) => bytes[4] !== 0xef)
									.map((bytes) => [...bytes.slice(3, 8)]),
							).toEqual([
								[1, 16, 1, 1, 4],
								[1, 16, 0, 1, 4],
							]);
							expect((yield* session.snapshot()).available).toBe(false);
							return;
						}
						yield* runtime.activate("device", "1,1", "down");
						expect(
							(yield* fake.writes)
								.filter((bytes) => bytes[4] !== 0xef)
								.map((bytes) => [...bytes.slice(3, 8)]),
						).toEqual([[1, 16, 1, 1, 4]]);
						active = undefined;
						yield* runtime.activate("device", "1,1", "cancel");
						yield* runtime.activate("device", "1,1", "up");
						expect(
							(yield* fake.writes)
								.filter((bytes) => bytes[4] !== 0xef)
								.map((bytes) => [...bytes.slice(3, 8)]),
						).toEqual([
							[1, 16, 1, 1, 4],
							[1, 16, 0, 1, 4],
						]);
					}).pipe(
						Effect.provide(
							layer(false, undefined, undefined, key, undefined, () => active),
						),
					);
				}),
			),
		);
	},
);

it.each([false, true])(
	"local player controls enforce committed quarantine=%s",
	async (unsupported) => {
		const base = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		const key = {
			...base,
			childrenName: "playAudio",
			compatibility: { unsupported },
			config: {
				...base.config,
				type: "playAudio",
				display: true,
				actions: [
					{ type: "sound", value: '["/fixture/a.mp3"]' },
					{ type: "audioAction", value: 0 },
					{ type: "audioFade", value: "0-0" },
					{ type: "volume", value: 50 },
				],
			},
		};
		const owned = vi.fn(async () => true);
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runtime = yield* KeyRuntime;
					const result = yield* runtime
						.preparePlayerControl(
							{
								deviceId: "device",
								profileId: "p",
								pageId: "one",
								revision: 0,
								keyCode: "1,1",
							},
							"toggle",
						)
						.pipe(Effect.flatten, Effect.either);
					expect(result._tag).toBe(unsupported ? "Left" : "Right");
					expect(owned).toHaveBeenCalledTimes(unsupported ? 0 : 1);
				}).pipe(Effect.provide(layer(false, undefined, undefined, key, owned))),
			),
		);
	},
);

it.each(["mute", "vol"])(
	"MAIN-073 MAIN-089 MGMT-168 MGMT-377 publishes external host state to committed %s artwork and disposes subscription",
	async (type) => {
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		const off = vi.fn();
		let listener: (reading: { level: number; muted: boolean }) => void =
			() => {};
		const media: MediaActionAdapter = {
			supportedCommands: new Set([
				"audio_mute",
				"audio_vol_down",
				"audio_vol_up",
			]),
			sendMedia: () => Effect.void,
			observe: (next) => {
				listener = next;
				return off;
			},
		};
		const states: import("../../../../../packages/device/src/actions/key-runtime-service").KeyFeedback[] =
			[];
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const ready = yield* Deferred.make<void>();
					const target = {
						...empty,
						childrenName: type,
						config: {
							...empty.config,
							type,
							supportKnob: type === "vol",
							actions:
								type === "mute"
									? [
											{ type: "key", value: "audio_mute" },
											{ type: "key", value: "audio_mute" },
										]
									: [
											{ type: "key", value: "audio_vol_down" },
											{ type: "key", value: "audio_vol_up" },
										],
						},
					};
					yield* Effect.gen(function* () {
						yield* KeyRuntimePort;
						listener({ level: 0, muted: true });
						yield* Deferred.await(ready);
					}).pipe(
						Effect.provide(
							layer(
								false,
								(state) =>
									Effect.sync(() => {
										states.push(state);
									}).pipe(
										Effect.zipRight(Deferred.succeed(ready, undefined)),
										Effect.asVoid,
									),
								media,
								target,
							),
						),
					);
				}),
			),
		);
		expect(states).toContainEqual({
			deviceId: "device",
			profileId: "p",
			pageId: "one",
			revision: 0,
			keyCode: "1,1",
			volume: 0,
			muted: true,
			...(type === "mute" ? { alternate: 1 } : {}),
		});
		expect(off).toHaveBeenCalledTimes(1);
	},
);

it.each(["up", "cancel", "reset"] as const)(
	"executes media hotkeys on down and never dispatches new commands during %s cleanup",
	async (terminal) => {
		const send = vi.fn(async () => ({ accepted: true }));
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		const key = {
			...empty,
			childrenName: "hotkey",
			config: {
				...empty.config,
				type: "hotkey",
				display: true,
				actions: [{ type: "key", value: "audio_play" }],
			},
		};
		await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const runtime = yield* KeyRuntime;
					yield* runtime.activate("device", "1,1", "down");
					expect(send).toHaveBeenCalledTimes(1);
					if (terminal === "reset") yield* runtime.reset("device");
					else yield* runtime.activate("device", "1,1", terminal);
					yield* runtime.activate("device", "1,1", "up");
					expect(send).toHaveBeenCalledTimes(1);
				}).pipe(
					Effect.provide(
						layer(false, undefined, systemMediaKeyActions(send), key),
					),
				),
			),
		);
	},
);

it.each([false, true])(
	"MAIN-068: rich clipboard restores after 50 ms and then arbitrary chord, concurrent edit=%s",
	async (changed) => {
		os.clipboard.mockReturnValue([
			"text/plain",
			"text/html",
			"text/rtf",
			"image/png",
		]);
		os.writeText.mockImplementation(() => {
			os.readText.mockReturnValue("inserted");
			os.clipboard.mockReturnValue(["text/plain"]);
		});
		const trace: string[] = [];
		const chords: string[] = [];
		await Effect.runPromise(
			Effect.gen(function* () {
				const p = yield* KeyRuntimePort;
				const fiber = yield* Effect.fork(
					p
						.execute({
							type: "text",
							actions: [
								{ type: "text", value: "inserted" },
								{ type: "key", value: "control+shift+s" },
							],
						})
						.pipe(Effect.tap(() => Effect.sync(() => trace.push("done")))),
				);
				yield* TestClock.adjust(49);
				expect(os.write).not.toHaveBeenCalled();
				expect(trace).toEqual([]);
				if (changed) os.readText.mockReturnValue("user copy");
				yield* TestClock.adjust(1);
				yield* Fiber.join(fiber);
				expect(os.write).toHaveBeenCalledTimes(changed ? 0 : 1);
				if (!changed)
					expect(os.write).toHaveBeenCalledWith({
						text: "before",
						html: "<b>before</b>",
						rtf: "rich",
						image: {},
					});
				expect(trace).toEqual(["done"]);
				expect(chords).toEqual([
					process.platform === "darwin" ? "command+v" : "control+v",
					"control+shift+s",
				]);
			}).pipe(
				Effect.provide(
					layer(false, undefined, undefined, undefined, undefined, undefined, {
						keyboard: {
							supportedTokens: new Set([
								"command",
								"control",
								"shift",
								"v",
								"s",
							]),
							pressChord: (chord) =>
								Effect.sync(() => {
									chords.push(chord);
								}),
						},
					}),
				),
				Effect.provide(TestContext.TestContext),
				Effect.scoped,
			),
		);
	},
);
it("MAIN-097: screenshots size all displays and save exact indexed names without native capture", async () => {
	const writes: { path: string; bytes: Uint8Array }[] = [];
	const capture = vi.fn(async () => [new Uint8Array([1]), new Uint8Array([2])]);
	await captureScreenshots({
		displays: () => [
			{ workAreaSize: { width: 200, height: 80 } },
			{ workAreaSize: { width: 100, height: 120 } },
		],
		capture,
		pictures: () => "/Pictures",
		now: () => 123,
		write: async (path, bytes) => {
			writes.push({ path, bytes });
		},
	});
	expect(capture).toHaveBeenCalledWith({ width: 200, height: 120 });
	expect(writes.map((w) => w.path)).toEqual([
		expect.stringMatching(/^\/Pictures\/screenshot-123-[a-f0-9-]+-0\.png$/),
		expect.stringMatching(/^\/Pictures\/screenshot-123-[a-f0-9-]+-1\.png$/),
	]);
	os.platform.mockReturnValue("win32");
	await lockWorkstation();
	expect(os.exec).toHaveBeenCalledWith("rundll32.exe", [
		"user32.dll,LockWorkStation",
	]);
});
it.each(["close", "screenshot", "lock", "managementCenter"] as const)(
	"saved %s enters the desktop adapter exactly once",
	async (type) => {
		const close = vi.fn(async () => {}),
			lock = vi.fn(async () => {}),
			management = vi.fn();
		const write = vi.fn(async () => {});
		const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
		const saved = {
			...empty,
			childrenName: type,
			config: {
				...empty.config,
				type,
				actions:
					type === "close"
						? [
								{ type: "path", value: "/App" },
								{ type: "force", value: "" },
							]
						: type === "managementCenter"
							? [{ type: "tabType", value: "keys" }]
							: [],
			},
		};
		await Effect.runPromise(
			Effect.gen(function* () {
				const r = yield* KeyRuntime;
				yield* r.activate("device", "1,1", "down");
				yield* r.activate("device", "1,1", "up");
			}).pipe(
				Effect.provide(
					layer(false, undefined, undefined, saved, undefined, undefined, {
						application: {
							list: async () => [{ pid: 31, path: "/App" }],
							identity: async () => "/App",
							focus: async () => {},
							launch: async () => {},
							terminate: close,
						},
						lock,
						management,
						screenshots: {
							displays: () => [],
							capture: async () => [new Uint8Array([1])],
							write,
							pictures: () => "/Pictures",
							now: () => 1,
						},
					}),
				),
				Effect.scoped,
			),
		);
		expect(close).toHaveBeenCalledTimes(type === "close" ? 1 : 0);
		expect(lock).toHaveBeenCalledTimes(type === "lock" ? 1 : 0);
		expect(management).toHaveBeenCalledTimes(
			type === "managementCenter" ? 1 : 0,
		);
		expect(write).toHaveBeenCalledTimes(type === "screenshot" ? 1 : 0);
	},
);

it("MAIN-076: desktop plugin port returns the typed unavailable error until plugins registers it", async () => {
	await Effect.runPromise(
		Effect.gen(function* () {
			const port = yield* KeyRuntimePort;
			if (!port.executePlugin)
				throw new Error("Missing typed plugin dispatch seam");
			const result = yield* Effect.either(
				port.executePlugin(
					{
						isPlugin: true,
						pluginId: "example",
						config: { type: "action", actions: [] },
					},
					{
						deviceId: "device",
						profileId: "p",
						pageId: "one",
						revision: 0,
						keyCode: "1,1",
						stepIndex: 0,
					},
				),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: {
					_tag: "KeyFunctionUnavailable",
					code: "QUAKE.ACTION.UNAVAILABLE",
					reason: "plugin-runtime",
				},
			});
		}).pipe(Effect.provide(layer()), Effect.scoped),
	);
});

it.each(["clear", "write"])(
	"review: clipboard %s failure restores the acquired snapshot with typed scrubbed cause",
	async (kind) => {
		const cause = Object.assign(new Error("private token=synthetic"), {
			code: "EIO",
		});
		os.clear.mockImplementation(() => {
			os.readText.mockReturnValue("");
			os.clipboard.mockReturnValue([]);
			if (kind === "clear") throw cause;
		});
		os.writeText.mockImplementation(() => {
			throw cause;
		});
		try {
			await Effect.runPromise(
				Effect.gen(function* () {
					const port = yield* KeyRuntimePort;
					const result = yield* Effect.either(
						port.execute({
							type: "text",
							actions: [{ type: "text", value: "inserted" }],
						}),
					);
					expect(result._tag).toBe("Left");
					if (result._tag === "Left") {
						expect(result.left).toMatchObject({
							_tag: "HostActionFailed",
							code: "QUAKE.ACTION.HOST_FAILED",
						});
						expect(result.left.originalCause).toBe(cause);
						expect(JSON.stringify(result.left)).not.toContain("synthetic");
					}
				}).pipe(Effect.provide(layer()), Effect.scoped),
			);
			expect(os.write).toHaveBeenCalledExactlyOnceWith({
				text: "before",
				html: "<b>before</b>",
				rtf: "rich",
				image: {},
			});
		} finally {
			os.clear.mockReset();
		}
	},
);
it("review: interruption after temporary clipboard write restores snapshot", async () => {
	os.writeText.mockImplementation(() => {
		os.readText.mockReturnValue("inserted");
		os.clipboard.mockReturnValue(["text/plain"]);
	});
	await Effect.runPromise(
		Effect.gen(function* () {
			const port = yield* KeyRuntimePort;
			const fiber = yield* Effect.fork(
				port.execute({
					type: "text",
					actions: [{ type: "text", value: "inserted" }],
				}),
			);
			yield* TestClock.adjust(0);
			yield* Fiber.interrupt(fiber);
			expect(os.write).toHaveBeenCalledOnce();
		}).pipe(
			Effect.provide(
				layer(false, undefined, undefined, undefined, undefined, undefined, {
					keyboard: {
						supportedTokens: new Set(["command", "control", "v"]),
						pressChord: () => Effect.never,
					},
				}),
			),
			Effect.provide(TestContext.TestContext),
			Effect.scoped,
		),
	);
});
it("review: simultaneous same-clock captures never overwrite an earlier image", async () => {
	const images = new Map<string, Uint8Array>();
	const port = {
		displays: () => [],
		capture: async () => [new Uint8Array([1])],
		pictures: () => "/Pictures",
		now: () => 123,
		write: async (path: string, bytes: Uint8Array) => {
			images.set(path, bytes);
		},
	};
	await Promise.all([captureScreenshots(port), captureScreenshots(port)]);
	expect(images.size).toBe(2);
});

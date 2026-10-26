import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Deferred, Effect, Layer, Schema } from "effect";
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
import { desktopKeyRuntimePort } from "./runtime-port";

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
	clipboard: vi.fn(),
	worker: vi.fn(),
}));
vi.mock("node:os", () => ({ platform: os.platform }));
vi.mock("node:child_process", () => ({
	execFile: (
		file: string,
		args: readonly string[],
		callback: (error: unknown) => void,
	) => {
		try {
			os.exec(file, args);
			callback(null);
		} catch (cause) {
			callback(cause);
		}
	},
}));
vi.mock("electron", () => ({
	BrowserWindow: os.worker,
	shell: { openPath: os.openPath, openExternal: os.openExternal },
	clipboard: { availableFormats: os.clipboard },
}));
afterEach(() => {
	vi.clearAllMocks();
	os.platform.mockReturnValue("darwin");
	os.openPath.mockResolvedValue("");
	os.exec.mockReset();
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
								(yield* fake.writes).map((bytes) => [...bytes.slice(3, 8)]),
							).toEqual([
								[1, 16, 1, 1, 4],
								[1, 16, 0, 1, 4],
							]);
							expect((yield* session.snapshot()).available).toBe(false);
							return;
						}
						yield* runtime.activate("device", "1,1", "down");
						expect(
							(yield* fake.writes).map((bytes) => [...bytes.slice(3, 8)]),
						).toEqual([[1, 16, 1, 1, 4]]);
						active = undefined;
						yield* runtime.activate("device", "1,1", "cancel");
						yield* runtime.activate("device", "1,1", "up");
						expect(
							(yield* fake.writes).map((bytes) => [...bytes.slice(3, 8)]),
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

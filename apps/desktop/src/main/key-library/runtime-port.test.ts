import { Deferred, Effect, Layer, Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors.js";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service.js";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import { desktopKeyRuntimePort } from "./runtime-port";

const os = vi.hoisted(() => ({
	platform: vi.fn(() => "darwin"),
	openPath: vi.fn(async (_path: string) => ""),
	openExternal: vi.fn(async (_url: string) => {}),
	exec: vi.fn<(file: string, args: readonly string[]) => void>(),
	clipboard: vi.fn(),
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
												{
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
		() => undefined,
		(state) => Effect.runSync(publish(state)),
		mock,
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

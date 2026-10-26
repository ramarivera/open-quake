import { expect, it } from "@effect/vitest";
import {
	Context,
	Effect,
	Either,
	Fiber,
	Layer,
	Redacted,
	Schema,
	TestClock,
} from "effect";
import { describe } from "vitest";
import {
	decodeObsCommand,
	OBS_IDS,
	type ObsId,
} from "../../../device/src/actions/obs-contracts.js";
import { fakeObsServer } from "./fake-server.test-support.js";
import {
	emptyObsSaved,
	type ObsDetection,
	type ObsSaved,
	type ObsTile,
} from "./obs-contracts.js";
import { ObsErrors, ObsNetworkFailed } from "./obs-errors.js";
import { ObsStorage } from "./obs-repository.js";
import { ObsPorts, ObsService } from "./obs-service.js";
import { openObsConnection } from "./obs-transport.js";

const settings: Readonly<
	Partial<Record<ObsId, Readonly<Record<string, unknown>>>>
> = {
	obsScene: { sceneUuid: "scene-1", sceneName: "Main" },
	obsPreviewScene: { sceneUuid: "scene-1" },
	obsStream: { mode: "toggle" },
	obsRecord: { mode: "toggle" },
	obsSource: { sceneUuid: "scene-1", sceneItemId: 7 },
	obsMute: { inputUuid: "input-1" },
	obsVolume: { inputUuid: "input-1" },
	obsTransitionSet: { transitionName: "Fade", durationMs: 300 },
	obsAudioMonitor: { inputUuid: "input-1", monitorType: "monitorOnly" },
	obsReplayBuffer: { action: "toggle" },
	obsMedia: { inputUuid: "input-1", mediaAction: "play" },
	obsFilter: {
		sourceName: "Camera",
		filterName: "Color",
		filterEnabled: false,
	},
	obsProfile: { kind: "profile", name: "Streaming" },
	obsSceneTransitionOverride: {
		sceneUuid: "scene-1",
		transitionName: "Fade",
		durationMs: 300,
	},
	obsScreenshot: { sourceName: "Main" },
};
const command = (id: ObsId, overrides?: Readonly<Record<string, unknown>>) => {
	const decoded = decodeObsCommand(
		id,
		JSON.stringify({ ...settings[id], ...overrides }),
	);
	if (Either.isLeft(decoded)) throw decoded.left;
	return decoded.right;
};
const fixture = (
	options: Parameters<typeof fakeObsServer>[0] = {},
	detect: () => Promise<ObsDetection | undefined> = async () => undefined,
) =>
	Effect.gen(function* () {
		const server = yield* Effect.acquireRelease(
			Effect.promise(() => fakeObsServer(options)),
			(server) => Effect.promise(server.close),
		);
		let saved: unknown = {
			...emptyObsSaved,
			port: server.port,
			manualOverride: true,
		};
		const secrets = new Map<string, string>();
		let nextSecret = 0;
		const published: {
			readonly owner: string;
			readonly tiles: readonly ObsTile[];
		}[] = [];
		const layers = Layer.mergeAll(
			Layer.succeed(ObsStorage, {
				store: {
					read: async () => saved,
					write: async (value) => {
						saved = value;
					},
				},
				vault: {
					put: async (value) => {
						const ref = `credential-${++nextSecret}`;
						secrets.set(ref, value);
						return ref;
					},
					get: async (ref) => secrets.get(ref) ?? "",
					remove: async (ref) => {
						secrets.delete(ref);
					},
				},
				detect,
			}),
			Layer.succeed(ObsPorts, {
				open: openObsConnection,
				publish: (owner, tiles) => {
					published.push({ owner, tiles });
				},
			}),
		);
		const service = Context.get(
			yield* Layer.build(ObsService.Default.pipe(Layer.provide(layers))),
			ObsService,
		);
		return {
			server,
			service,
			published,
			secrets,
			saved: () => saved,
			setSaved: (value: ObsSaved) => {
				saved = value;
			},
		};
	});
const expected: Readonly<Record<ObsId, readonly string[]>> = {
	obsScene: ["SetCurrentProgramScene"],
	obsPreviewScene: ["SetCurrentPreviewScene"],
	obsTransition: ["TriggerStudioModeTransition"],
	obsStudioMode: ["GetStudioModeEnabled", "SetStudioModeEnabled"],
	obsStream: ["ToggleStream"],
	obsRecord: ["ToggleRecord"],
	obsSource: ["GetSceneItemEnabled", "SetSceneItemEnabled"],
	obsMute: ["ToggleInputMute"],
	obsVolume: ["ToggleInputMute"],
	obsCut: ["SetCurrentSceneTransition", "TriggerStudioModeTransition"],
	obsTransitionSet: [
		"SetCurrentSceneTransition",
		"SetCurrentSceneTransitionDuration",
	],
	obsAudioMonitor: ["SetInputAudioMonitorType"],
	obsReplayBuffer: ["ToggleReplayBuffer"],
	obsVirtualCam: ["ToggleVirtualCam"],
	obsMedia: ["TriggerMediaInputAction"],
	obsFilter: ["SetSourceFilterEnabled"],
	obsProfile: ["SetCurrentProfile"],
	obsRecordSplit: ["SplitRecordFile"],
	obsSceneTransitionOverride: ["SetSceneSceneTransitionOverride"],
	obsStats: [],
	obsScreenshot: [],
};
describe("21 recovered commands through authenticated v5", () => {
	for (const id of OBS_IDS)
		it.scoped(id, () =>
			Effect.gen(function* () {
				const { service, server } = yield* fixture({
					password: "fixture-only-password",
				});
				yield* service.configure(
					{ host: "127.0.0.1", port: server.port, autoConnect: false },
					Redacted.make("fixture-only-password"),
				);
				yield* service.execute(command(id));
				expect(server.calls.map((call) => call.type)).toEqual(expected[id]);
				if (id === "obsScene")
					expect(server.calls[0]?.data).toEqual({ sceneUuid: "scene-1" });
				if (id === "obsSource")
					expect(server.calls[1]?.data).toEqual({
						sceneUuid: "scene-1",
						sceneItemId: 7,
						sceneItemEnabled: false,
					});
				if (id === "obsStudioMode")
					expect(server.calls[1]?.data).toEqual({ studioModeEnabled: true });
				if (id === "obsAudioMonitor")
					expect(server.calls[0]?.data).toEqual({
						inputUuid: "input-1",
						monitorType: "OBS_MONITORING_TYPE_MONITOR_ONLY",
					});
				if (id === "obsMedia")
					expect(server.calls[0]?.data).toEqual({
						inputUuid: "input-1",
						mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
					});
				if (id === "obsProfile")
					expect(server.calls[0]?.data).toEqual({ profileName: "Streaming" });
				if (id === "obsSceneTransitionOverride")
					expect(server.calls[0]?.data).toEqual({
						sceneUuid: "scene-1",
						transitionName: "Fade",
						transitionDuration: 300,
					});
			}),
		);
});
it.scoped("volume reads current value and clamps both directions", () =>
	Effect.gen(function* () {
		const { service, server } = yield* fixture();
		yield* service.execute(command("obsVolume"), 1);
		expect(server.state.volume).toBe(1);
		server.state.volume = 0.01;
		yield* service.execute(command("obsVolume"), -1);
		expect(server.state.volume).toBe(0);
		yield* service.execute(command("obsVolume"), 1);
		expect(server.state.volume).toBe(0.05);
	}),
);
it.scoped(
	"record pause, replay operations, media actions and scene collection parameters",
	() =>
		Effect.gen(function* () {
			const { service, server } = yield* fixture();
			yield* service.execute(command("obsRecord", { mode: "pause" }));
			for (const action of ["save", "start", "stop"])
				yield* service.execute(command("obsReplayBuffer", { action }));
			for (const action of [
				"PLAY",
				"PAUSE",
				"STOP",
				"RESTART",
				"NEXT",
				"PREVIOUS",
			])
				yield* service.execute(
					command("obsMedia", {
						mediaAction: `OBS_WEBSOCKET_MEDIA_INPUT_ACTION_${action}`,
					}),
				);
			yield* service.execute(
				command("obsProfile", { kind: "sceneCollection", name: "Production" }),
			);
			expect(server.calls.map((c) => c.type)).toEqual([
				"PauseRecord",
				"SaveReplayBuffer",
				"StartReplayBuffer",
				"StopReplayBuffer",
				...Array.from({ length: 6 }, () => "TriggerMediaInputAction"),
				"SetCurrentSceneCollection",
			]);
			expect(server.calls.at(-1)?.data).toEqual({
				sceneCollectionName: "Production",
			});
		}),
);
it.scoped(
	"password stays in protected storage and public state has no secret or reference",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture();
			yield* f.service.configure(
				{ host: "127.0.0.1", port: f.server.port, autoConnect: true },
				Redacted.make("private-password"),
			);
			expect([...f.secrets.values()]).toEqual(["private-password"]);
			expect(JSON.stringify(f.saved())).not.toContain("private-password");
			const snapshot = yield* f.service.status();
			expect(snapshot.passwordSet).toBe(true);
			expect(JSON.stringify(snapshot)).not.toContain("credential-");
			yield* f.service.configure(
				{ host: "127.0.0.1", port: f.server.port, autoConnect: true },
				Redacted.make(""),
			);
			expect(f.secrets.size).toBe(0);
		}),
);
it.scoped(
	"authentication failure stops retries until explicit correction",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture({ password: "correct" });
			yield* f.service.configure(
				{ host: "127.0.0.1", port: f.server.port, autoConnect: true },
				Redacted.make("wrong"),
			);
			const result = yield* Effect.either(f.service.connect());
			expect(result._tag).toBe("Left");
			if (result._tag === "Left") {
				expect(result.left.code).toBe(ObsErrors.ObsAuthenticationFailed.code);
				expect(JSON.stringify(result.left)).not.toContain("do-not-leak");
			}
			const repeated = yield* Effect.either(
				f.service.execute(command("obsStream")),
			);
			expect(repeated._tag === "Left" && repeated.left.code).toBe(
				ObsErrors.ObsAuthenticationFailed.code,
			);
			yield* TestClock.adjust(10_000);
			expect(f.server.connections()).toBe(1);
			yield* f.service.configure(
				{ host: "127.0.0.1", port: f.server.port, autoConnect: true },
				Redacted.make("correct"),
			);
			expect((yield* f.service.connect()).state).toBe("connected");
		}),
);
it.scoped("old RPC version is a distinct non-retrying failure", () =>
	Effect.gen(function* () {
		const f = yield* fixture({ rpcVersion: 0 });
		const result = yield* Effect.either(f.service.connect());
		expect(result._tag === "Left" && result.left.code).toBe(
			"OBS.RPC.UNSUPPORTED",
		);
		yield* TestClock.adjust(10_000);
		expect(f.server.connections()).toBe(1);
	}),
);
it.scoped("reconnects after connection loss without replaying a write", () =>
	Effect.gen(function* () {
		const f = yield* fixture();
		yield* f.service.connect();
		yield* f.service.execute(command("obsStream"));
		f.server.disconnect();
		yield* Effect.promise(() => f.server.waitFor(() => true));
		// Let native close events arrive independently of TestClock.
		yield* Effect.promise(
			() => new Promise<void>((resolve) => setImmediate(resolve)),
		);
		yield* TestClock.adjust(1000);
		yield* Effect.promise(() =>
			f.server.waitFor(() => f.server.connections() === 2),
		);
		expect(
			f.server.calls.filter((c) => c.type === "ToggleStream"),
		).toHaveLength(1);
	}),
);
it.scoped(
	"visible status, stats and screenshots refresh at 2000 ms and release stops polling",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture();
			yield* f.service.connect();
			yield* f.service.setVisible(
				"panel",
				["obsStream", "obsStats", "obsScreenshot"].map((id) => ({
					id,
					command: command(
						Schema.decodeUnknownSync(
							Schema.Literal("obsStream", "obsStats", "obsScreenshot"),
						)(id),
					),
				})),
			);
			yield* TestClock.adjust(1999);
			expect(f.server.calls).toHaveLength(0);
			yield* TestClock.adjust(1);
			yield* Effect.promise(() =>
				f.server.waitFor(() => f.server.calls.length === 3),
			);
			// Joining poll waits for the same in-flight refresh to publish.
			yield* f.service.poll();
			expect(f.published[0]?.tiles[0]?.text).toBe("live");
			expect(f.published[0]?.tiles[1]?.values).toEqual([12.34, 2, 3, 100]);
			expect(f.published[0]?.tiles[2]?.image).toBe(
				"data:image/jpeg;base64,/9j/2Q==",
			);
			expect(
				f.server.calls.find((c) => c.type === "GetSourceScreenshot")?.data,
			).toEqual({
				sourceName: "Main",
				imageFormat: "jpeg",
				imageWidth: 128,
				imageHeight: 128,
			});
			yield* f.service.release("panel");
			const count = f.server.calls.length;
			yield* TestClock.adjust(4000);
			expect(f.server.calls).toHaveLength(count);
		}),
);
it.scoped(
	"replacing visible entries discards responses from a previous profile",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture();
			yield* f.service.connect();
			f.server.hold(["GetStats"]);
			yield* f.service.setVisible("panel", [
				{ id: "old", command: command("obsStats") },
			]);
			const polling = yield* Effect.fork(f.service.poll());
			yield* Effect.promise(() =>
				f.server.waitFor(() =>
					f.server.calls.some((c) => c.type === "GetStats"),
				),
			);
			yield* f.service.setVisible("panel", []);
			yield* Fiber.interrupt(polling);
			expect(f.published).toHaveLength(0);
		}),
);
it.scoped(
	"request failure keeps canonical identity and never includes remote comments",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture();
			f.server.fail(["ToggleStream"]);
			const result = yield* Effect.either(
				f.service.execute(command("obsStream")),
			);
			expect(result._tag === "Left" && result.left.code).toBe(
				"OBS.REQUEST.FAILED",
			);
			expect(JSON.stringify(result)).not.toContain("do-not-leak");
		}),
);
it.scoped(
	"rejects unconfigured hosts and invalid command targets before IO",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture();
			for (const host of [
				"0.0.0.0",
				"user:password@localhost",
				"localhost/path",
				"localhost?secret=yes",
				"::",
			]) {
				expect(
					(yield* Effect.either(
						f.service.configure({ host, port: 4455, autoConnect: true }),
					))._tag,
				).toBe("Left");
			}
			expect(
				(yield* Effect.either(
					f.service.execute({ type: "obsScene", settings: {} }),
				))._tag,
			).toBe("Left");
			expect(f.server.connections()).toBe(0);
		}),
);
it("error catalog retains original cause privately with scrubbed diagnostics", () => {
	const original = new Error("password=private");
	const error = new ObsNetworkFailed(original);
	expect(error.originalCause).toBe(original);
	expect(JSON.stringify(error)).not.toContain("private");
	expect(JSON.stringify(error)).not.toContain("originalCause");
});
it.scoped(
	"volume rechecks committed ownership after its async read and before a write",
	() =>
		Effect.gen(function* () {
			const { service, server } = yield* fixture();
			let checked = false;
			const result = yield* Effect.either(
				service.execute(command("obsVolume"), 1, async () => {
					checked = true;
					expect(server.calls.at(-1)?.type).toBe("GetInputVolume");
					throw new Error("stale owner");
				}),
			);
			expect(checked).toBe(true);
			expect(result._tag === "Left" && result.left.code).toBe(
				"OBS.CONFIG.REJECTED",
			);
			expect(server.calls.map((call) => call.type)).toEqual(["GetInputVolume"]);
			expect((yield* service.status()).state).toBe("connected");
		}),
);
it.scoped(
	"catalog identifies special audio inputs and detection preserves a manual connection",
	() =>
		Effect.gen(function* () {
			const { service, server } = yield* fixture();
			yield* service.connect();
			const catalog = yield* service.catalog("scene-1");
			expect(catalog.inputs[0]).toMatchObject({
				inputUuid: "input-1",
				special: true,
			});
			expect(catalog.items).toEqual([{ sceneItemId: 7, sourceName: "Camera" }]);
			expect(catalog.inputs[1]).toMatchObject({
				inputUuid: "Desktop Audio",
				inputName: "Desktop Audio",
				special: true,
			});
			yield* service.execute(
				command("obsVolume", {
					inputUuid: "Desktop Audio",
					inputName: "Desktop Audio",
				}),
				-1,
			);
			expect(server.calls.at(-1)?.data.inputName).toBe("Desktop Audio");
			expect(server.calls.at(-1)?.data).not.toHaveProperty("inputUuid");
			expect(server.state.volume).toBeCloseTo(0.93);
			expect((yield* service.detect()).state).toBe("connected");
			expect(server.connections()).toBe(1);
		}),
);

for (const autoConnect of [false, true])
	it.scoped(
		`Auto-fetch reconnects detected settings with autoConnect=${autoConnect}`,
		() =>
			Effect.gen(function* () {
				const target = yield* Effect.acquireRelease(
					Effect.promise(() => fakeObsServer({ password: "detected" })),
					(server) => Effect.promise(server.close),
				);
				const f = yield* fixture({}, async () => ({
					port: target.port,
					password: "detected",
					source: "fixture",
				}));
				f.setSaved({ ...emptyObsSaved, port: f.server.port, autoConnect });
				yield* f.service.connect();
				const status = yield* f.service.detect();
				expect(status).toMatchObject({
					state: "connected",
					port: target.port,
					detection: "found",
					autoConnect,
				});
				yield* f.service.execute(command("obsStream"));
				expect(target.calls.map((call) => call.type)).toEqual(["ToggleStream"]);
				expect(f.server.calls).toHaveLength(0);
			}),
	);
it.scoped(
	"startup detection and a manual disconnect do not override auto-connect policy",
	() =>
		Effect.gen(function* () {
			let port = 0;
			const f = yield* fixture({}, async () => ({
				port,
				password: "",
				source: "fixture",
			}));
			port = f.server.port;
			f.setSaved({ ...emptyObsSaved, autoConnect: false });
			yield* f.service.initialize();
			expect(f.server.connections()).toBe(0);
			yield* f.service.connect();
			yield* f.service.disconnect();
			expect((yield* f.service.detect()).state).toBe("disconnected");
			yield* TestClock.adjust(10000);
			expect(f.server.connections()).toBe(1);
		}),
);
it.scoped("Auto-fetch authentication failure stays blocked and private", () =>
	Effect.gen(function* () {
		let port = 0;
		const f = yield* fixture({ password: "correct" }, async () => ({
			port,
			password: "wrong-private",
			source: "fixture",
		}));
		port = f.server.port;
		f.setSaved({ ...emptyObsSaved });
		const result = yield* Effect.either(f.service.detect());
		expect(result._tag === "Left" && result.left.code).toBe("OBS.AUTH.FAILED");
		expect((yield* f.service.status()).state).toBe("failed");
		expect(JSON.stringify(result)).not.toContain("wrong-private");
		yield* TestClock.adjust(10000);
		expect(f.server.connections()).toBe(1);
	}),
);

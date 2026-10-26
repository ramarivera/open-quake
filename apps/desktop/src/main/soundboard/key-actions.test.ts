import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Schema, TestClock } from "effect";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../../../../packages/device/src/actions/key-runtime-service";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { rig } from "../../../../../packages/edge/src/soundboard/playback-test-fixtures";
import { soundboardKeyActions } from "./key-actions";

const activation = {
	deviceId: "device",
	profileId: "p",
	pageId: "one",
	revision: 1,
};
const key = (audioAction: number, audioFade = "0-0", type = "playAudio") =>
	Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")),
		childrenName: type,
		config: {
			...Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1")).config,
			type,
			actions: [
				{
					type: "sound",
					value: JSON.stringify([
						"/private/music/a.mp3",
						"/private/music/b.mp3",
					]),
				},
				{ type: "audioAction", value: audioAction },
				{ type: "audioFade", value: audioFade },
				{ type: "volume", value: 50 },
			],
		},
	});

it.scoped(
	"runs all recovered codes through the committed-key adapter and existing player",
	() =>
		Effect.gen(function* () {
			const f = yield* rig();
			const keys = soundboardKeyActions(f.service);
			yield* keys.execute(key(0), activation);
			expect(f.tracks).toHaveLength(1);
			yield* keys.execute(key(1), activation);
			expect(
				(yield* f.service.snapshot()).filter((s) => s.state === "playing"),
			).toHaveLength(2);
			yield* keys.execute(key(2), activation);
			expect(f.tracks).toHaveLength(3);
			expect(f.tracks[0]?.closed).toBe(1);
			yield* keys.execute(key(6), activation);
			expect(f.tracks.at(-1)?.fileId).toBe("sound-1");
			yield* keys.execute(key(5), activation);
			expect(f.tracks.at(-1)?.fileId).toBe("sound-0");
			yield* keys.execute(key(4), activation);
			expect(
				(yield* f.service.snapshot()).every((s) => s.state === "stopped"),
			).toBe(true);
			yield* keys.execute(key(3, "0-0", "playAudioLegacy"), activation);
			const active = (yield* f.service.snapshot()).at(-1);
			expect(active?.loopTrack).toBe(true);
			if (!active) throw new Error("missing active session");
			yield* f.service.naturalEnd(active);
			expect(f.tracks.at(-1)?.fileId).toBe("sound-0");
			yield* keys.execute(key(3), activation);
			expect(
				(yield* f.service.snapshot()).every((s) => s.state === "stopped"),
			).toBe(true);
		}),
);

it.scoped(
	"waits for decoded fade-out before restart and loops beyond the last track",
	() =>
		Effect.gen(function* () {
			const f = yield* rig();
			const keys = soundboardKeyActions(f.service);
			yield* keys.execute(key(0), activation);
			const restart = yield* Effect.fork(
				keys.execute(key(2, "2-1000"), activation),
			);
			yield* TestClock.adjust(500);
			expect(f.tracks).toHaveLength(1);
			expect(f.tracks[0]?.gains.at(-1)).toBeCloseTo(0.25, 1);
			yield* TestClock.adjust(500);
			yield* Fiber.join(restart);
			expect(f.tracks).toHaveLength(2);
			// Repeated natural ends cross the playlist boundary more than once.
			for (let i = 0; i < 5; i++) {
				const active = (yield* f.service.snapshot()).at(-1);
				if (!active) throw new Error("missing active session");
				yield* f.service.naturalEnd(active);
			}
			expect(f.tracks.at(-1)?.fileId).toBe("sound-1");
			yield* keys.reset("device");
			expect(
				(yield* f.service.snapshot()).every((s) => s.state === "stopped"),
			).toBe(true);
		}),
);

it.scoped(
	"real KeyRuntime opens nothing on press, executes once on release, and resets owned playback",
	() =>
		Effect.gen(function* () {
			const f = yield* rig();
			const keys = soundboardKeyActions(f.service);
			const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
				schemaVersion: 1,
				profiles: [
					{
						id: "p",
						name: "P",
						revision: 1,
						pages: [
							{ id: "one", keys: [Schema.encodeSync(ProfileKey)(key(0))] },
						],
					},
				],
				activeByDevice: { device: { profileId: "p", pageId: "one" } },
			});
			const layer = KeyRuntime.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.succeed(KeyRuntimePort, {
						read: Effect.succeed(envelope),
						execute: () => Effect.die("generic executor must not handle audio"),
						executeOwned: (key, context) =>
							keys.execute(key, context).pipe(Effect.orDie),
						resetOwned: keys.reset,
						publish: () => Effect.void,
						select: () => Effect.void,
						alarm: () => Effect.die("must stay silent"),
					}),
				),
			);
			yield* Effect.gen(function* () {
				const runtime = yield* KeyRuntime;
				yield* runtime.activate("device", "1,1", "press");
				expect(f.tracks).toHaveLength(0);
				yield* runtime.activate("device", "1,1", "release");
				expect(f.tracks).toHaveLength(1);
				yield* runtime.activate("device", "1,1", "release");
				expect(f.tracks).toHaveLength(1);
				yield* runtime.reset("device");
				expect(f.tracks[0]?.closed).toBe(1);
			}).pipe(Effect.provide(layer));
		}),
);

it.scoped(
	"KNOB-089 committed local-player transport reuses soundboard playback and rejects stale targets",
	() =>
		Effect.gen(function* () {
			const f = yield* rig(),
				keys = soundboardKeyActions(f.service);
			const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
				schemaVersion: 1,
				profiles: [
					{
						id: "p",
						name: "P",
						revision: 1,
						pages: [
							{ id: "one", keys: [Schema.encodeSync(ProfileKey)(key(0))] },
						],
					},
				],
				activeByDevice: { device: { profileId: "p", pageId: "one" } },
			});
			const layer = KeyRuntime.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.succeed(KeyRuntimePort, {
						read: Effect.succeed(envelope),
						execute: () => Effect.die("OS transport must not run"),
						executeOwned: (key, activation) =>
							keys.execute(key, activation).pipe(Effect.orDie),
						publish: () => Effect.void,
						select: () => Effect.void,
						alarm: () => Effect.die("must stay silent"),
					}),
				),
			);
			yield* Effect.gen(function* () {
				const runtime = yield* KeyRuntime,
					target = { ...activation, keyCode: "1,1" };
				for (const intent of ["toggle", "next", "previous", "stop"] as const) {
					const completion = yield* runtime.preparePlayerControl(
						target,
						intent,
					);
					yield* completion;
				}
				expect(f.tracks.map((track) => track.fileId)).toEqual([
					"sound-0",
					"sound-1",
					"sound-0",
				]);
				expect(
					(yield* f.service.snapshot()).every(
						(session) => session.state === "stopped",
					),
				).toBe(true);
				const work = yield* runtime.preparePlayerControl(
					{ ...target, revision: 0 },
					"toggle",
				);
				yield* work;
				expect(f.tracks).toHaveLength(3);
			}).pipe(Effect.provide(layer));
		}),
);

it.scoped(
	"KNOB-096 WIDGETS-111 persists per-device resume without autoplay and seeks the canonical player on intent",
	() =>
		Effect.gen(function* () {
			let stored: unknown = {};
			const store = {
				read: async () => stored,
				write: async (value: unknown) => {
					stored = value;
				},
			};
			const intent = (value: string) => {
				const original = key(0);
				return {
					...original,
					config: {
						...original.config,
						actions: [
							...original.config.actions,
							{ type: "musicSource", value: "local" },
							{ type: "playerIntent", value },
						],
					},
				};
			};
			const first = yield* rig(),
				keys = soundboardKeyActions(first.service, store);
			yield* keys.execute(intent("toggle"), activation);
			if (!first.tracks[0]) throw new Error("missing fake track");
			first.tracks[0].positionMs = 4321;
			expect((yield* keys.read(key(0), activation)).positionMs).toBe(4321);
			yield* keys.reset();
			const second = yield* rig(),
				restarted = soundboardKeyActions(second.service, store);
			expect((yield* restarted.read(key(0), activation)).positionMs).toBe(4321);
			expect(second.tracks).toHaveLength(0);
			expect(
				(yield* restarted.read(key(0), { ...activation, deviceId: "other" }))
					.positionMs,
			).toBe(0);
			yield* restarted.execute(intent("toggle"), activation);
			expect(second.tracks[0]?.positionMs).toBe(4321);
			expect(second.tracks[0]?.plays).toBe(1);
			yield* restarted.execute(intent("toggle"), activation);
			expect((yield* restarted.read(key(0), activation)).state).toBe("paused");
			const before = second.tracks.length;
			yield* restarted.execute(intent("next"), activation);
			expect(second.tracks).toHaveLength(before);
			yield* restarted.execute(intent("toggle"), activation);
			yield* restarted.execute(intent("next"), activation);
			yield* restarted.execute(intent("next"), activation);
			expect((yield* restarted.read(key(0), activation)).trackIndex).toBe(0);
			const system = intent("toggle");
			expect(
				yield* restarted.execute(
					{
						...system,
						config: {
							...system.config,
							actions: system.config.actions.map((a) =>
								a.type === "musicSource" ? { ...a, value: "system" } : a,
							),
						},
					},
					activation,
				),
			).toBe(false);
		}),
);

for (const terminal of ["stop", "preempt", "reset"] as const) {
	it.scoped(
		`retains sampled resume across ${terminal}, repeated polls and restart`,
		() =>
			Effect.gen(function* () {
				let stored: unknown = {};
				const store = {
					read: async () => stored,
					write: async (value: unknown) => {
						stored = value;
					},
				};
				const original = key(0);
				const intent = (value: string) => ({
					...original,
					config: {
						...original.config,
						actions: [
							...original.config.actions.map((a) =>
								a.type === "audioAction" && value === "next"
									? { ...a, value: 6 }
									: a,
							),
							{ type: "musicSource", value: "local" },
							{ type: "playerIntent", value },
						],
					},
				});
				const f = yield* rig();
				const keys = soundboardKeyActions(f.service, store);
				yield* keys.execute(intent("toggle"), activation);
				yield* keys.execute(intent("next"), activation);
				const track = f.tracks.at(-1);
				if (!track) throw new Error("missing fake track");
				track.positionMs = 4321;
				expect(yield* keys.read(original, activation)).toMatchObject({
					trackIndex: 1,
					positionMs: 4321,
				});
				if (terminal === "stop")
					yield* keys.execute(intent("stop"), activation);
				else if (terminal === "preempt")
					yield* f.output.acquire("speech", Effect.void);
				else yield* keys.reset();
				for (let i = 0; i < 2; i++)
					expect(yield* keys.read(original, activation)).toMatchObject({
						state: "stopped",
						trackIndex: 1,
						positionMs: 4321,
					});
				const second = yield* rig();
				const restarted = soundboardKeyActions(second.service, store);
				expect(yield* restarted.read(original, activation)).toMatchObject({
					trackIndex: 1,
					positionMs: 4321,
				});
				expect(second.tracks).toHaveLength(0);
				yield* restarted.execute(intent("toggle"), activation);
				expect(second.tracks[0]).toMatchObject({
					fileId: "sound-1",
					positionMs: 4321,
					plays: 1,
				});
			}),
	);
}

it.scoped(
	"card Stop only stops its committed owner, including when already idle",
	() =>
		Effect.gen(function* () {
			const f = yield* rig();
			const keys = soundboardKeyActions(f.service);
			const other = { ...activation, deviceId: "other" };
			yield* keys.execute(key(0), activation);
			yield* keys.execute(key(0), other);
			const stop = key(4);
			const cardStop = {
				...stop,
				config: {
					...stop.config,
					actions: [
						...stop.config.actions,
						{ type: "playerIntent", value: "stop" },
					],
				},
			};
			for (let i = 0; i < 2; i++) {
				yield* keys.execute(cardStop, activation);
				expect((yield* keys.read(key(0), activation)).state).toBe("stopped");
				expect((yield* keys.read(key(0), other)).state).toBe("playing");
			}
			expect(f.tracks[1]?.closed).toBe(0);
		}),
);

it.scoped(
	"position sampling preserves the newest additive playback selection while paused",
	() =>
		Effect.gen(function* () {
			const f = yield* rig();
			const keys = soundboardKeyActions(f.service);
			yield* keys.execute(key(1), activation);
			yield* keys.execute(key(1), activation);
			const before = yield* keys.snapshot();
			const latest = before.at(-1);
			if (!latest) throw new Error("missing session");
			const original = key(1);
			const toggle = {
				...original,
				config: {
					...original.config,
					actions: [
						...original.config.actions,
						{ type: "playerIntent", value: "toggle" },
					],
				},
			};
			yield* keys.execute(toggle, activation);
			for (let i = 0; i < 2; i++) {
				expect((yield* keys.read(original, activation)).state).toBe("paused");
				expect((yield* keys.snapshot()).map((s) => s.playbackId)).toEqual(
					before.map((s) => s.playbackId),
				);
			}
			yield* keys.execute(toggle, activation);
			expect(
				(yield* keys.snapshot()).find((s) => s.playbackId === latest.playbackId)
					?.state,
			).toBe("playing");
			expect(f.tracks[0]?.plays).toBe(1);
			expect(f.tracks[1]?.plays).toBe(2);
		}),
);

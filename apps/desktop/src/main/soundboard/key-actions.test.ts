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

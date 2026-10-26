import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema, TestClock } from "effect";
import { AUDIO_OPERATIONS } from "../../src/actions/action-contracts.js";
import { HostActionFailed } from "../../src/actions/action-errors.js";
import {
	actionAvailability,
	validateAction,
} from "../../src/actions/action-invariants.js";
import {
	createActionDraft,
	findAction,
} from "../../src/actions/action-registry.js";
import { executeActionLeaf } from "../../src/actions/action-service.js";
import {
	KeyRuntime,
	KeyRuntimePort,
} from "../../src/actions/key-runtime-service.js";
import { builtinProfiles } from "../../src/profiles/profile-catalog.js";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../src/profiles/profile-contracts.js";
import { harness } from "./action-harness.js";

it.effect(
	"MGMT-226 MGMT-290 all twelve Audio and Media operations route to media, including pause and mute",
	() =>
		Effect.gen(function* () {
			const h = harness(),
				calls: string[] = [];
			const adapters = {
				...h.adapters,
				media: Option.some({
					supportedCommands: new Set(AUDIO_OPERATIONS),
					sendMedia: (token: string) =>
						Effect.sync(() => {
							calls.push(token);
						}),
				}),
			};
			for (const type of ["hotkey", "media"])
				for (const token of AUDIO_OPERATIONS) {
					const config = yield* validateAction(type, {
						type,
						actions: [{ type: "key", value: token }],
					});
					yield* executeActionLeaf(config, adapters);
				}
			expect(calls).toEqual([...AUDIO_OPERATIONS, ...AUDIO_OPERATIONS]);
			expect(h.calls).toEqual([]);
			const mute = findAction("mute");
			if (!mute) throw new Error("mute missing");
			expect(actionAvailability(mute, adapters)).toBe("available");
			const rejected = yield* Effect.either(
				executeActionLeaf(
					yield* validateAction("media", {
						type: "media",
						actions: [{ type: "key", value: "audio_pause" }],
					}),
					{ ...adapters, media: Option.none() },
				),
			);
			expect(rejected._tag).toBe("Left");
		}),
);
it.effect(
	"MGMT-167/168/169 MGMT-375/376/377 saved Quick controls validate with directional support and actual mute dispatch",
	() =>
		Effect.gen(function* () {
			const h = harness();
			const calls: string[] = [];
			const adapters = {
				...h.adapters,
				media: Option.some({
					supportedCommands: new Set(AUDIO_OPERATIONS),
					sendMedia: (token: string) =>
						Effect.sync(() => {
							calls.push(token);
						}),
				}),
			};
			for (const platform of ["darwin", "win32", "linux"] as const)
				for (const profile of builtinProfiles(platform))
					for (const page of profile.pages)
						for (const key of page.keys)
							if (["vol", "mute", "brightness"].includes(key.config.type)) {
								const action = yield* validateAction(
									key.config.type,
									Schema.encodeSync(ProfileKey)(key).config,
								);
								expect(key.config.supportKnob).toBe(key.config.type !== "mute");
								if (action.type === "mute")
									yield* executeActionLeaf(action, adapters);
							}
			expect(calls.length).toBeGreaterThan(0);
			expect(calls.every((c) => c === "audio_mute")).toBe(true);
		}),
);
it.scoped(
	"MGMT-208 MGMT-209 executes mute and all eight media sequence leaves in order and stops at first failure",
	() =>
		Effect.gen(function* () {
			const ids = [
				"mute",
				"playPause",
				"stopPlay",
				"skipBackward",
				"skipForward",
				"fastBackward",
				"fastForward",
				"repeatPlay",
				"randomPlay",
			] as const;
			const raw = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
			const config = {
				type: "multiActions",
				actions: [],
				subActions: ids.map((id) => ({
					config: { ...createActionDraft(id), gap: 0 },
				})),
			};
			const key = Schema.decodeUnknownSync(ProfileKey)({
				...raw,
				childrenName: "multiActions",
				config: { ...raw.config, ...config },
			});
			const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
				schemaVersion: 1,
				profiles: [
					{
						id: "p",
						name: "P",
						revision: 0,
						pages: [{ id: "one", keys: [Schema.encodeSync(ProfileKey)(key)] }],
					},
				],
				activeByDevice: { device: { profileId: "p", pageId: "one" } },
			});
			const calls: string[] = [];
			let fail = false;
			const h = harness();
			const adapters = {
				...h.adapters,
				media: Option.some({
					supportedCommands: new Set(AUDIO_OPERATIONS),
					sendMedia: (token: string) =>
						Effect.suspend(() => {
							calls.push(token);
							return fail && token === "audio_next"
								? Effect.fail(new HostActionFailed("unavailable"))
								: Effect.void;
						}),
				}),
			};
			const layer = KeyRuntime.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.succeed(KeyRuntimePort, {
						read: Effect.succeed(envelope),
						execute: (config) => executeActionLeaf(config, adapters),
						publish: () => Effect.void,
						alarm: () => Effect.die("silent"),
						select: () => Effect.void,
					}),
				),
			);
			yield* Effect.gen(function* () {
				const runtime = yield* KeyRuntime;
				yield* runtime.activate("device", "1,1", "press");
				yield* TestClock.adjust(1);
				expect(calls).toEqual([
					"audio_mute",
					"audio_play",
					"audio_stop",
					"audio_prev",
					"audio_next",
					"audio_rewind",
					"audio_forward",
					"audio_repeat",
					"audio_random",
				]);
				yield* runtime.activate("device", "1,1", "release");
				calls.length = 0;
				fail = true;
				yield* runtime.activate("device", "1,1", "press");
				yield* TestClock.adjust(1);
				expect(calls).toEqual([
					"audio_mute",
					"audio_play",
					"audio_stop",
					"audio_prev",
					"audio_next",
				]);
			}).pipe(Effect.provide(layer));
		}),
);

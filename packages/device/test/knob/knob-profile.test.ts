import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Layer, Option, Schema } from "effect";
import { saveProfileKnob } from "../../src/knob/knob-profile.js";
import { migrateKnobVoiceActions } from "../../src/knob/knob-voice-migration.js";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../src/profiles/profile-contracts.js";
import { profileStorageLayer } from "../../src/profiles/profile-repository.js";
import { ProfileService } from "../../src/profiles/profile-service.js";
import { knob, nextPage } from "./fixtures.js";

describe("profile-owned knob saves", () => {
	it.scoped(
		"preserves all pages, keys, profile metadata and selections, and rejects stale saves",
		() => {
			const profiles = [
				Schema.decodeUnknownSync(importProfile)({
					id: "p",
					name: "Profile",
					revision: 0,
					pages: [
						{
							id: "page",
							keys: [
								Schema.encodeSync(importKey)(createEmptyProfileKey("1,1")),
							],
						},
					],
					compatibility: { keep: true },
				}),
				Schema.decodeUnknownSync(importProfile)({
					id: "other",
					name: "Other",
					revision: 0,
					pages: [{ id: "otherpage", keys: [] }],
				}),
			];
			const initial = Schema.decodeUnknownSync(ProfileEnvelope)({
				schemaVersion: 1,
				profiles: profiles
					.slice(0, 2)
					.map((p) => Schema.encodeSync(importProfile)(p)),
				activeByDevice: {},
			});
			let stored = encodeProfileEnvelope(initial);
			const layer = ProfileService.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => stored,
						write: async (value) => {
							stored = value;
						},
					}),
				),
			);
			return Effect.gen(function* () {
				const profile = initial.profiles[0];
				const saved = yield* saveProfileKnob(
					profile.id,
					profile.revision,
					knob(),
				);
				const changed = saved.profiles[0];
				expect(changed.pages).toEqual(profile.pages);
				expect(changed.name).toBe(profile.name);
				expect(saved.profiles[1]).toEqual(initial.profiles[1]);
				expect(saved.activeByDevice).toEqual(initial.activeByDevice);
				expect(changed.revision).toBe(profile.revision + 1);
				expect(Option.getOrThrow(changed.knob).config.subActions).toEqual(
					knob().config.subActions,
				);
				const conflict = yield* saveProfileKnob(
					profile.id,
					profile.revision,
					knob([nextPage, nextPage, nextPage]),
				).pipe(Effect.either);
				expect(Either.isLeft(conflict) && conflict.left._tag).toBe(
					"ProfileRevisionConflict",
				);
				expect(stored).toEqual(encodeProfileEnvelope(saved));
				const malformedHa = knob([
					{
						childrenName: "homeAssistant",
						config: {
							type: "homeAssistant",
							actions: [{ type: "configData", value: "{}" }],
						},
					},
					nextPage,
					nextPage,
				]);
				const invalid = yield* saveProfileKnob(
					profile.id,
					changed.revision,
					malformedHa,
				).pipe(Effect.either);
				expect(Either.isLeft(invalid) && invalid.left._tag).toBe(
					"ProfileValidationFailed",
				);
				expect(stored).toEqual(encodeProfileEnvelope(saved));
			}).pipe(Effect.provide(layer));
		},
	);
});

import {
	ProfileKey as importKey,
	Profile as importProfile,
} from "../../src/profiles/profile-contracts.js";

const preview = (
	source: unknown,
	providers: readonly { id: string; provider: string; modelId: string }[],
	agentIds?: readonly string[],
) => {
	const result = migrateKnobVoiceActions(source, {
		providers,
		...(agentIds ? { agentIds } : {}),
	});
	if (Either.isLeft(result)) throw result.left;
	return result.right;
};
const legacy = [
	{ type: "voiceRoute", value: "direct" },
	{ type: "model", value: "local/org/model" },
];
describe("route migration preview resolution", () => {
	it("resolves exactly one saved provider profile while preserving original data", () => {
		const result = preview(legacy, [
			{ id: "saved-local", provider: "local", modelId: "org/model" },
		]);
		expect(result.status).toBe("ready");
		expect(result.original).toEqual(legacy);
		expect(result.actions).toEqual([
			{ type: "voiceRoute", value: "direct" },
			{ type: "directProvider", value: "saved-local" },
			{ type: "directModel", value: "org/model" },
		]);
		expect(preview(result, [])).toEqual(result);
	});
	it("requires configuration for missing or ambiguous provider profiles", () => {
		for (const providers of [
			[],
			[
				{ id: "a", provider: "local", modelId: "org/model" },
				{ id: "b", provider: "local", modelId: "org/model" },
			],
		]) {
			const result = preview(legacy, providers);
			expect(result.status).toBe("needsConfiguration");
			expect(result.original).toEqual(legacy);
		}
	});
	it("gives explicit profile IDs precedence over ambiguous provider aliases", () => {
		const result = preview(
			[...legacy, { type: "directProvider", value: "b" }],
			[
				{ id: "a", provider: "local", modelId: "org/model" },
				{ id: "b", provider: "local", modelId: "org/model" },
			],
		);
		expect(result.status).toBe("ready");
		expect(result.actions.find((a) => a.type === "directProvider")?.value).toBe(
			"b",
		);
	});
	it("never invents main for missing or ambiguous agents", () => {
		const source = [
			{ type: "voiceRoute", value: "dkclaw" },
			{ type: "model", value: "p/m" },
		];
		for (const agents of [[], ["main", "second"]]) {
			const result = preview(source, [], agents);
			expect(result.status).toBe("needsConfiguration");
			expect(result.actions.find((a) => a.type === "agentId")?.value).toBe("");
		}
		expect(
			preview(source, [], ["only"]).actions.find((a) => a.type === "agentId")
				?.value,
		).toBe("only");
		expect(
			preview(
				[
					{ type: "voiceRoute", value: "dkclaw" },
					{ type: "agentId", value: "only" },
				],
				[],
				["only"],
			).status,
		).toBe("needsConfiguration");
		expect(preview([], []).status).toBe("needsMigration");
	});
});

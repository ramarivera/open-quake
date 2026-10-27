import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
	emptyKnobResource,
	emptyKnobSlot,
} from "../../../../../packages/device/src/knob/knob-invariants";
import {
	type AssistantSettings,
	defaultAssistantSettings,
} from "../../../../../packages/device/src/profiles/assistant-contracts";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";
import { pinKnobProfile } from "./voice-route";

const route = [
	{ type: "voiceRoute", value: "direct" },
	{ type: "directProvider", value: "saved-provider" },
	{ type: "directModel", value: "org/model" },
];
const envelope = (
	actions: unknown = route,
	assistantSettings?: AssistantSettings,
) =>
	Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "profile",
				name: "P",
				revision: 7,
				pages: [{ id: "page", keys: [] }],
				knob: {
					...emptyKnobResource(),
					config: {
						...emptyKnobResource().config,
						subActions: [
							{
								childrenName: "assistant",
								config: {
									type: "assistant",
									actions,
									...(assistantSettings ? { assistantSettings } : {}),
								},
							},
							emptyKnobSlot(),
							emptyKnobSlot(),
						],
					},
				},
			},
		],
		activeByDevice: { QK: { profileId: "profile", pageId: "page" } },
	});
describe("committed knob route pinning", () => {
	it.effect(
		"pins the selected device's profile revision and exact saved references",
		() =>
			Effect.gen(function* () {
				expect(yield* pinKnobProfile(envelope(), "QK")).toEqual({
					profileId: "profile",
					revision: 7,
					route: "direct",
					providerId: "saved-provider",
					modelId: "org/model",
				});
			}),
	);
	it.effect(
		"rejects missing selection, incomplete fields, credentials and unsupported routes",
		() =>
			Effect.gen(function* () {
				for (const [source, serial] of [
					[envelope(), "missing"],
					[
						envelope(
							route.map((a) =>
								a.type === "directModel" ? { ...a, value: "" } : a,
							),
						),
						"QK",
					],
					[
						envelope([...route, { type: "apiKey", value: "must-not-run" }]),
						"QK",
					],
					[
						envelope([
							{ type: "voiceRoute", value: "legacyAssistant" },
							{ type: "assistant", value: "preserved" },
						]),
						"QK",
					],
				] as const)
					expect(
						(yield* pinKnobProfile(source, serial).pipe(Effect.either))._tag,
					).toBe("Left");
			}),
	);
	it("retains the original failure privately and only serializes scrubbed catalog diagnostics", () => {
		const cause = Object.assign(
			new Error("private secret=must-not-serialize"),
			{ code: "ECONNREFUSED" },
		);
		const error = new VoiceKnobRejected("RouteIncomplete", cause);
		expect(error.code).toBe("VOICE.KNOB.ROUTE_INCOMPLETE");
		expect(error.originalCause).toBe(cause);
		expect(Object.keys(error)).not.toContain("originalCause");
		expect(JSON.stringify(error)).not.toContain("must-not-serialize");
	});
});

it.effect("disabled knob voice input cannot pin a capture route", () =>
	Effect.gen(function* () {
		const result = yield* pinKnobProfile(
			envelope(route, {
				...defaultAssistantSettings(),
				useAgent: false,
				enableVoiceInput: false,
			}),
			"QK",
		).pipe(Effect.either);
		expect(result._tag === "Left" && result.left.code).toBe(
			"VOICE.KNOB.ROUTE_UNAVAILABLE",
		);
	}),
);

it.effect(
	"KNOB-032 pins the committed DK Claw identity and optional model without a direct provider",
	() =>
		Effect.gen(function* () {
			for (const model of ["", "retained/unknown"]) {
				const pinned = yield* pinKnobProfile(
					envelope([
						{ type: "voiceRoute", value: "dkclaw" },
						{ type: "agentId", value: "writer" },
						...(model ? [{ type: "dkclawModel", value: model }] : []),
					]),
					"QK",
				);
				expect(pinned).toMatchObject({
					route: "dkclaw",
					agentId: "writer",
					modelId: model,
					providerId: "",
					revision: 7,
				});
			}
		}),
);

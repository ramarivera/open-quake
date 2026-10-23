import { describe, expect, it } from "@effect/vitest";
import { Either, Schema } from "effect";
import * as fc from "fast-check";
import {
	CredentialRef,
	InferenceRequest,
	NormalizedEvent,
	ProfileSummary,
	ProviderProfile,
} from "./ai-contracts.js";
import {
	credentialRedirectAllowed,
	profileSummary,
	validateProfile,
	validateRequest,
	validEndpoint,
} from "./ai-invariants.js";
import { MOCK_PROFILE } from "./ai-repository.js";

const request: InferenceRequest = {
	profileId: MOCK_PROFILE.id,
	messages: [{ role: "user", content: [{ _tag: "text", text: "hello" }] }],
	requestedCapabilities: [],
	sampling: {},
};

describe("AI contracts and invariants", () => {
	it("round-trips profiles, requests, summaries and every normalized event", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1 }).filter((value) => value.trim() === value),
				(modelId) => {
					const profile = { ...MOCK_PROFILE, modelId };
					expect(
						Schema.decodeUnknownSync(ProviderProfile)(
							Schema.encodeSync(ProviderProfile)(profile),
						),
					).toEqual(profile);
					expect(
						Schema.decodeUnknownSync(InferenceRequest)(
							Schema.encodeSync(InferenceRequest)(request),
						),
					).toEqual(request);
					const summary = profileSummary(profile);
					expect(
						Schema.decodeUnknownSync(ProfileSummary)(
							Schema.encodeSync(ProfileSummary)(summary),
						),
					).toEqual(summary);
				},
			),
		);
		for (const event of [
			{ _tag: "textDelta", textDelta: "hello", kind: "generation" },
			{ _tag: "suggestion", suggestionId: "next", text: "more" },
			{
				_tag: "usage",
				usage: { inputTokens: 1, outputTokens: 2, provenance: "reported" },
			},
			{ _tag: "completed" },
		] as const)
			expect(
				Schema.decodeUnknownSync(NormalizedEvent)(
					Schema.encodeSync(NormalizedEvent)(event),
				),
			).toEqual(event);
	});
	it("projects an allowlisted summary and rejects credential-bearing extra fields", () => {
		const credentialRef = Schema.decodeUnknownSync(CredentialRef)(
			"00000000-0000-4000-8000-000000000002",
		);
		const profile = {
			...MOCK_PROFILE,
			adapter: "openai-compatible" as const,
			auth: "apiKey" as const,
			credentialRef,
		};
		expect(Either.isRight(validateProfile(profile))).toBe(true);
		expect(Object.keys(profileSummary(profile)).sort()).toEqual([
			"adapter",
			"auth",
			"capabilities",
			"id",
			"modelId",
		]);
		expect(JSON.stringify(profileSummary(profile))).not.toContain(
			credentialRef,
		);
		expect(
			Either.isLeft(
				validateProfile({ ...profile, apiKey: crypto.randomUUID() }),
			),
		).toBe(true);
	});
	it("requires supported capability evidence, including image parts omitted from the capability list", () => {
		for (const capability of [
			"text",
			"tools",
			"images",
			"imageGeneration",
			"videoGeneration",
			"stt",
			"tts",
		] as const) {
			for (const status of ["unsupported", "unverified"] as const) {
				const profile = {
					...MOCK_PROFILE,
					capabilities: { ...MOCK_PROFILE.capabilities, [capability]: status },
				};
				expect(
					validateRequest(profile, {
						...request,
						requestedCapabilities: [capability],
					}),
				).toEqual(Either.left({ reason: "capability", capability }));
			}
		}
		expect(
			validateRequest(MOCK_PROFILE, {
				...request,
				messages: [
					{
						role: "user",
						content: [{ _tag: "image", url: "https://image.invalid" }],
					},
				],
			}),
		).toEqual(Either.left({ reason: "capability", capability: "images" }));
	});
	it("rejects non-text mock capabilities even when the profile declares support", () => {
		for (const capability of [
			"tools",
			"images",
			"imageGeneration",
			"videoGeneration",
			"stt",
			"tts",
		] as const) {
			const profile: ProviderProfile = {
				...MOCK_PROFILE,
				capabilities: {
					...MOCK_PROFILE.capabilities,
					[capability]: "supported",
				},
			};
			expect(Either.isLeft(validateProfile(profile))).toBe(true);
			expect(
				validateRequest(profile, {
					...request,
					requestedCapabilities: [capability],
				}),
			).toEqual(Either.left({ reason: "capability", capability }));
			if (capability === "images")
				expect(
					validateRequest(profile, {
						...request,
						messages: [
							{
								role: "user",
								content: [{ _tag: "image", url: "https://image.invalid" }],
							},
						],
					}),
				).toEqual(Either.left({ reason: "capability", capability: "images" }));
		}
	});
	it("enforces explicit endpoint policy and same-origin redirects", () => {
		for (const endpoint of [
			"http://example.com",
			"https://user:pass@example.com",
			"https://example.com?token=x",
			"https://example.com#secret",
			"file:///tmp/a",
			"not a url",
		])
			expect(validEndpoint(endpoint, "remote")).toBe(false);
		for (const hostname of ["localhost", "127.0.0.1", "127.2.3.4", "[::1]"]) {
			expect(validEndpoint(`http://${hostname}:1234/v1`, "loopback")).toBe(
				true,
			);
			expect(validEndpoint(`http://${hostname}:1234/v1`, "remote")).toBe(false);
		}
		expect(validEndpoint("http://localhost.attacker.invalid", "loopback")).toBe(
			false,
		);
		expect(validEndpoint("https://example.com", "loopback")).toBe(false);
		expect(
			credentialRedirectAllowed(
				"https://example.com/v1",
				"https://example.com/v2",
				"remote",
			),
		).toBe(true);
		fc.assert(
			fc.property(fc.integer({ min: 1025, max: 65535 }), (port) => {
				expect(
					credentialRedirectAllowed(
						"https://example.com/v1",
						`https://example.com:${port}/v2`,
						"remote",
					),
				).toBe(false);
			}),
		);
		for (const destination of [
			"https://other.invalid",
			"http://example.com/v2",
			"https://example.com:444/v2",
		])
			expect(
				credentialRedirectAllowed(
					"https://example.com/v1",
					destination,
					"remote",
				),
			).toBe(false);
	});
	it("rejects malformed, unsupported and out-of-range sampling without altering inputs", () => {
		const profile: ProviderProfile = {
			...MOCK_PROFILE,
			sampling: { temperature: 1 },
			samplingLimits: {
				temperature: { min: 0, max: 2 },
				topP: { min: 0, max: 1 },
				maxOutputTokens: 100,
			},
		};
		expect(
			Either.getOrThrow(validateRequest(profile, request)).sampling,
		).toEqual({ temperature: 1 });
		fc.assert(
			fc.property(
				fc.double({ min: 2.01, max: 1000, noNaN: true }),
				(temperature) => {
					expect(
						Either.isLeft(
							validateRequest(profile, {
								...request,
								sampling: { temperature },
							}),
						),
					).toBe(true);
				},
			),
		);
		for (const sampling of [
			{ temperature: NaN },
			{ topP: 1.1 },
			{ maxOutputTokens: 101 },
			{ maxOutputTokens: 0 },
			{ maxOutputTokens: 1.5 },
		])
			expect(
				Either.isLeft(validateRequest(profile, { ...request, sampling })),
			).toBe(true);
		expect(
			Either.isLeft(
				validateRequest(MOCK_PROFILE, {
					...request,
					sampling: { temperature: 1 },
				}),
			),
		).toBe(true);
		expect(
			Either.isLeft(
				validateProfile({
					...profile,
					samplingLimits: { temperature: { min: 2, max: 1 } },
				}),
			),
		).toBe(true);
		expect(
			Either.isLeft(validateProfile({ ...MOCK_PROFILE, auth: "apiKey" })),
		).toBe(true);
	});
});

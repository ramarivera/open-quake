import {
	Effect,
	Layer,
	ManagedRuntime,
	Redacted,
	Schema,
	Stream,
} from "effect";
import { describe, expect, it } from "vitest";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants.js";
import { AiCompatibleAdapter } from "../../../../../packages/edge/src/ai/adapters/adapter.js";
import {
	type InferenceRequest,
	type NormalizedEvent,
	ProfileId,
} from "../../../../../packages/edge/src/ai/ai-contracts.js";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials.js";
import { AiRepository } from "../../../../../packages/edge/src/ai/ai-repository.js";
import { AiProviderService } from "../../../../../packages/edge/src/ai/ai-service.js";
import { agentDraftsFromProvider } from "./drafting";

describe("agent AI draft adapter through the provider facade", () => {
	it("uses a selected provider, parses JSON safely and cancels the generation on completion", async () => {
		let output =
			'{"IDENTITY.md":"# Identity","SOUL.md":"# Role","AGENTS.md":"# Rules"}';
		let calls = 0;
		let closed = 0;
		const requests: InferenceRequest[] = [];
		const ports = Layer.mergeAll(
			Layer.succeed(AiCredentials, {
				resolve: () => Effect.succeed(Redacted.make("test-key")),
				revoked: () => Effect.never,
			}),
			Layer.succeed(AiCompatibleAdapter, {
				open: ({ request }) => {
					calls++;
					requests.push(request);
					const events: readonly NormalizedEvent[] = [
						{ _tag: "textDelta", textDelta: output, kind: "generation" },
						{ _tag: "completed" },
					];
					return Effect.succeed(
						Stream.fromIterable(events).pipe(
							Stream.ensuring(
								Effect.sync(() => {
									closed++;
								}),
							),
						),
					);
				},
			}),
		);
		const runtime = ManagedRuntime.make(
			AiProviderService.DefaultWithoutDependencies.pipe(
				Layer.provideMerge(AiRepository.Default),
				Layer.provide(ports),
			),
		);
		try {
			const id = Schema.decodeUnknownSync(ProfileId)(
				"10000000-0000-4000-8000-000000000001",
			);
			await runtime.runPromise(
				AiRepository.put({
					version: 1,
					id,
					adapter: "openai-compatible",
					baseUrl: "https://api.example.test/v1",
					endpointPolicy: "remote",
					modelId: "draft-model",
					auth: "apiKey",
					credentialRef: "20000000-0000-4000-8000-000000000001",
					authGeneration: 0,
					capabilities: {
						text: "supported",
						tools: "unsupported",
						images: "unsupported",
						imageGeneration: "unsupported",
						videoGeneration: "unsupported",
						stt: "unsupported",
						tts: "unsupported",
					},
					sampling: {},
					samplingLimits: { maxOutputTokens: 4096 },
				}),
			);
			const provider = await runtime.runPromise(AiProviderService);
			const adapter = agentDraftsFromProvider(provider, {
				request: (_agentId, prompt) =>
					Effect.succeed({
						profileId: id,
						messages: [
							{ role: "user", content: [{ _tag: "text", text: prompt }] },
						],
						requestedCapabilities: ["text"],
						sampling: { maxOutputTokens: 4096 },
					}),
			});
			const agent = initialAgentState().agents[0];
			if (!agent) throw new Error("Missing fixture main");
			const files = await runtime.runPromise(
				adapter.agent({ agent, prompt: "Research" }),
			);
			expect(files["SOUL.md"]).toBe("# Role");
			expect(calls).toBe(1);
			expect(closed).toBe(1);
			expect(JSON.stringify(requests)).toContain("Research");
			expect(JSON.stringify(requests)).not.toContain("test-key");
			output = "process.exit(1)";
			const invalid = await runtime.runPromise(
				adapter.agent({ agent, prompt: "Research" }).pipe(Effect.either),
			);
			expect(invalid._tag === "Left" && invalid.left.code).toBe(
				"AGENT.DRAFT.FAILED",
			);
			expect(closed).toBe(2);
		} finally {
			await runtime.dispose();
		}
	});
});

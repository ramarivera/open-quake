import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Redacted } from "effect";
import { expect, it } from "vitest";
import { emptyKnobResource } from "../../../../../packages/device/src/knob/knob-invariants";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants";
import { AiAuthRequired } from "../../../../../packages/edge/src/ai/ai-errors";
import {
	editKnobSlot,
	knobVoiceReady,
} from "../../renderer/src/keys/knob-draft";
import { createDirectChat } from "./host";

it.each<ModelRow["role"]>(["none", "default", "fallback"])(
	"editor readiness and production knob pinning agree for saved role %s",
	async (role) => {
		const directory = await mkdtemp(join(tmpdir(), "knob-model-role-"));
		const row: ModelRow = {
			id: "saved",
			provider: "openai",
			model: "model",
			baseUrl: "https://example.invalid/v1",
			role,
			maxTokens: 1024,
			credentialRef: "00000000-0000-4000-8000-000000000001",
		};
		const state = { ...initialAgentState(), models: { default: [row] } };
		const host = createDirectChat({
			directory,
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("synthetic")),
				revoked: () => Effect.never,
			},
			models: () => Effect.succeed(state.models.default),
		});
		try {
			const knob = editKnobSlot(emptyKnobResource(), "center", {
				childrenName: "assistant",
				config: {
					type: "assistant",
					actions: [
						{ type: "voiceRoute", value: "direct" },
						{ type: "directProvider", value: "saved" },
						{ type: "directModel", value: "model" },
					],
				},
			});
			const pinned = await host.runtime.runPromise(
				host.pinKnobModel("saved", "model").pipe(Effect.either),
			);
			const ready = knobVoiceReady(knob, [
				{ ...row, credentialAvailable: true },
			]);
			const listing = await host.runtime.runPromise(host.providers());
			expect(listing[0]?.directCapable).toBe(ready);
			expect(ready).toBe(Either.isRight(pinned));
			expect(ready).toBe(role !== "none");
		} finally {
			await host.runtime.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	},
);

it("AI-005/048 direct knob selects a catalog model and pins it independently of the assistant default", async () => {
	const directory = await mkdtemp(join(tmpdir(), "knob-catalog-"));
	const row: ModelRow = {
		id: "saved",
		role: "default",
		provider: "deepseek",
		model: "deepseek-v4-flash",
		baseUrl: "https://selected.invalid/v1",
		maxTokens: 1024,
		credentialRef: "00000000-0000-4000-8000-000000000001",
	};
	const host = createDirectChat({
		directory,
		models: () => Effect.succeed([row]),
		credentials: {
			resolve: () => Effect.succeed(Redacted.make("fixture")),
			revoked: () => Effect.never,
		},
	});
	try {
		const pinned = await host.runtime.runPromise(
			host.pinKnobModel("saved", "deepseek-v4-pro"),
		);
		expect(pinned.profile.modelId).toBe("deepseek-v4-pro");
		expect(row.model).toBe("deepseek-v4-flash");
	} finally {
		await host.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

it.each(["", "not-a-credential-uuid", "00000000-0000-4000-8000-000000000001"])(
	"retains catalog and custom options while needing a key: %s",
	async (credentialRef) => {
		const directory = await mkdtemp(join(tmpdir(), "keyless-catalog-"));
		let resolutions = 0;
		const host = createDirectChat({
			directory,
			models: () =>
				Effect.succeed([
					{
						id: "saved",
						role: "default",
						provider: "qwen",
						model: "custom-qwen-model",
						baseUrl: "https://selected.invalid/v1",
						maxTokens: 1024,
						credentialRef,
					},
				]),
			credentials: {
				resolve: () => {
					resolutions++;
					return Effect.fail(new AiAuthRequired());
				},
				revoked: () => Effect.never,
			},
		});
		try {
			const [listing] = await host.runtime.runPromise(host.providers());
			expect(listing).toMatchObject({
				id: "saved",
				available: false,
				directCapable: false,
				state: "needs-key",
			});
			expect(listing?.options.map((option) => option.id)).toEqual(
				expect.arrayContaining(["qwen3.6-plus", "custom-qwen-model"]),
			);
			expect(resolutions).toBe(credentialRef.startsWith("00000000") ? 1 : 0);
			expect(JSON.stringify(listing)).not.toContain("credentialRef");
		} finally {
			await host.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	},
);

it.each(["private-model", "gpt-4o", " ", "x".repeat(201)])(
	"knob custom readiness and runtime agree without assistant settings: %s",
	async (modelId) => {
		const directory = await mkdtemp(join(tmpdir(), "knob-custom-"));
		const row: ModelRow = {
			id: "saved",
			role: "default",
			provider: "openai",
			model: "gpt-4o",
			baseUrl: "https://fake.invalid/v1",
			maxTokens: 1024,
			credentialRef: "00000000-0000-4000-8000-000000000001",
		};
		const host = createDirectChat({
			directory,
			models: () => Effect.succeed([row]),
			credentials: {
				resolve: () => Effect.succeed(Redacted.make("fake")),
				revoked: () => Effect.never,
			},
		});
		try {
			const knob = editKnobSlot(emptyKnobResource(), "center", {
				childrenName: "assistant",
				config: {
					type: "assistant",
					actions: [
						{ type: "voiceRoute", value: "direct" },
						{ type: "directProvider", value: "saved" },
						{ type: "directModel", value: modelId },
					],
				},
			});
			const ready = knobVoiceReady(knob, [
				{ ...row, credentialAvailable: true },
			]);
			const pinned = await host.runtime.runPromise(
				host.pinKnobModel("saved", modelId).pipe(Effect.either),
			);
			expect(ready).toBe(modelId.trim().length > 0 && modelId.length <= 200);
			expect(Either.isRight(pinned)).toBe(ready);
			if (Either.isRight(pinned))
				expect(pinned.right.profile.modelId).toBe(modelId);
		} finally {
			await host.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	},
);

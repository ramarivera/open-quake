import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Redacted } from "effect";
import { expect, it } from "vitest";
import { emptyKnobResource } from "../../../../../packages/device/src/knob/knob-invariants";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants";
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

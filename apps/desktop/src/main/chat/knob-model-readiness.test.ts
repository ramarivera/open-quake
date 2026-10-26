import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Redacted } from "effect";
import { expect, it } from "vitest";
import { emptyKnobResource } from "../../../../../packages/device/src/knob/knob-invariants";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import {
	initialAgentState,
	resolveModels,
} from "../../../../../packages/edge/src/agents/agents-invariants";
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
			models: () => Effect.succeed(resolveModels(state, "default")),
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
			expect(ready).toBe(Either.isRight(pinned));
			expect(ready).toBe(role !== "none");
		} finally {
			await host.runtime.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	},
);

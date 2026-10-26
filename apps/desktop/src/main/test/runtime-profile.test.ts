import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Option, Redacted } from "effect";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants";
import { AiAuthRequired } from "../../../../../packages/edge/src/ai/ai-errors";
import { readRuntimeProfile } from "./runtime-profile";

const row: ModelRow = {
	id: "chosen",
	role: "default",
	provider: "generic",
	model: "authorized-model",
	baseUrl: "https://example.invalid/v1",
	maxTokens: 256,
	credentialRef: "00000000-0000-4000-8000-000000000001",
};
const selection = { rowId: row.id, scope: "main", authorizedModel: row.model };
const saved = (rows: readonly ModelRow[]) => ({
	read: () =>
		Effect.succeed(
			Option.some({ ...initialAgentState(), models: { main: rows } }),
		),
});
const unexpected = () => Effect.die("Credential owner must not be called");
describe("production profile selection for container acceptance", () => {
	it.effect(
		"pins the exact saved row and resolves its native credential reference",
		() =>
			Effect.gen(function* () {
				const calls: unknown[] = [];
				const other = {
					...row,
					id: "other",
					model: "different",
					credentialRef: "00000000-0000-4000-8000-000000000002",
				};
				const result = yield* readRuntimeProfile(
					selection,
					saved([other, row]),
					{
						resolve: (reference, generation) =>
							Effect.sync(() => {
								calls.push({ reference, generation });
								return Redacted.make("private-key");
							}),
						revoked: unexpected,
					},
				);
				expect(calls).toEqual([
					{ reference: row.credentialRef, generation: 0 },
				]);
				expect(result.profile).toMatchObject({
					baseUrl: row.baseUrl,
					modelId: row.model,
					adapter: "openai-compatible",
				});
				expect(Redacted.value(result.apiKey)).toBe("private-key");
				expect(JSON.stringify(result)).not.toContain("private-key");
			}),
	);
	for (const changed of [
		[],
		[row, row],
		[{ ...row, model: "not-authorized" }],
		[{ ...row, credentialRef: "" }],
		[{ ...row, baseUrl: "https://user:private@example.invalid/v1" }],
	]) {
		it.effect(
			`refuses invalid or unauthorized rows before credential access: ${JSON.stringify(changed.map((r) => r.id))}`,
			() =>
				Effect.gen(function* () {
					const result = yield* readRuntimeProfile(selection, saved(changed), {
						resolve: unexpected,
						revoked: unexpected,
					}).pipe(Effect.either);
					expect(result).toMatchObject({
						_tag: "Left",
						left: { code: "AI.PROVIDER.CONFIG_INVALID" },
					});
				}),
		);
	}
	it.effect("refuses absent storage without creating a default profile", () =>
		Effect.gen(function* () {
			const result = yield* readRuntimeProfile(
				selection,
				{ read: () => Effect.succeed(Option.none()) },
				{ resolve: unexpected, revoked: unexpected },
			).pipe(Effect.either);
			expect(result).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.CONFIG_INVALID" },
			});
		}),
	);
	it.effect(
		"keeps the typed native credential failure and private original cause",
		() =>
			Effect.gen(function* () {
				const cause = new Error("private keychain path");
				const error = new AiAuthRequired(cause);
				const result = yield* readRuntimeProfile(selection, saved([row]), {
					resolve: () => Effect.fail(error),
					revoked: unexpected,
				}).pipe(Effect.either);
				expect(result._tag).toBe("Left");
				if (result._tag === "Left") {
					expect(Cause.originalError(result.left)).toBe(error);
					expect(result.left.originalCause).toBe(cause);
				}
				expect(JSON.stringify(result)).not.toContain("private keychain path");
			}),
	);
});

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Stream, TestClock } from "effect";
import type { RuntimeCapabilities } from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeAuthenticationFailed,
	RuntimeCapabilityUnsupported,
	type RuntimeError,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";
import { createRuntimeResources } from "./resources.js";

const capabilities: RuntimeCapabilities = {
	health: "supported",
	chat: "supported",
	listAgents: "supported",
	sessions: "supported",
	resources: "supported",
	models: "supported",
	toolEvents: "unverified",
	usage: "unverified",
};
function fixture(
	overrides: Partial<RuntimeProviderAdapter> = {},
	includeOptional = true,
) {
	const calls: string[] = [];
	const adapter: RuntimeProviderAdapter = {
		kind: "openclaw",
		health: () =>
			Effect.succeed({ status: "ready", lifecycle: "externallyManaged" }),
		capabilities: () => Effect.succeed(capabilities),
		listAgents: (c) =>
			Effect.sync(() => {
				calls.push(`agents:${c.id}`);
				return [{ id: "remote/agent:1", name: "Remote" }];
			}),
		listModels: (c) =>
			Effect.sync(() => {
				calls.push(`models:${c.id}`);
				return [{ id: "model:1", name: "Model" }];
			}),
		listSessions: (c) =>
			Effect.sync(() => {
				calls.push(`sessions:${c.id}`);
				return [{ id: "session/1" }];
			}),
		listResources: (c, id) =>
			Effect.sync(() => {
				calls.push(`resources:${c.id}:${id}`);
				return [
					{ id: "remote-file", name: "Remote file", kind: "file" as const },
				];
			}),
		streamConversation: () => Stream.empty,
		...overrides,
	};
	let resolutions = 0;
	const resources = createRuntimeResources((id) =>
		Effect.sync(() => {
			resolutions++;
			return {
				connection: {
					id,
					name: "Remote",
					kind: "openclaw" as const,
					baseURL: "http://fixture.test",
					credentialRef: "private-ref",
				},
				adapter: includeOptional
					? adapter
					: {
							kind: adapter.kind,
							health: adapter.health,
							capabilities: adapter.capabilities,
							listAgents: adapter.listAgents,
							streamConversation: adapter.streamConversation,
						},
			};
		}),
	);
	return { resources, calls, resolutions: () => resolutions };
}
describe("provider resource boundary", () => {
	it.effect(
		"returns verified provider catalogs with opaque ids, never local workspace data",
		() =>
			Effect.gen(function* () {
				const f = fixture();
				expect(f.resolutions()).toBe(0);
				const result = yield* f.resources.discover("connection");
				expect(result).toEqual({
					capabilities,
					agents: [{ id: "remote/agent:1", name: "Remote" }],
					models: [{ id: "model:1", name: "Model" }],
				});
				expect(f.calls).toEqual(["agents:connection", "models:connection"]);
				expect(JSON.stringify(result)).not.toMatch(
					/private-ref|credential|IDENTITY.md/,
				);
				expect(yield* f.resources.listSessions("connection")).toEqual([
					{ id: "session/1" },
				]);
				yield* f.resources.listResources("connection", "remote/agent:1");
				expect(f.calls.at(-1)).toBe("resources:connection:remote/agent:1");
				expect(f.resources).not.toHaveProperty("write");
				expect(f.resources).not.toHaveProperty("delete");
			}),
	);
	for (const status of ["unsupported", "unverified"] as const) {
		it.effect(
			`keeps ${status} catalog status and never calls those provider operations`,
			() =>
				Effect.gen(function* () {
					const f = fixture({
						capabilities: () =>
							Effect.succeed({
								...capabilities,
								listAgents: status,
								sessions: status,
								resources: status,
								models: status,
							}),
					});
					const result = yield* f.resources.discover("connection");
					expect(result.agents).toEqual([]);
					expect(result.capabilities.listAgents).toBe(status);
					expect(result.models).toBeUndefined();
					const works: readonly Effect.Effect<unknown, RuntimeError>[] = [
						f.resources.listAgents("connection"),
						f.resources.listModels("connection"),
						f.resources.listSessions("connection"),
						f.resources.listResources("connection", "remote"),
					];
					for (const work of works) {
						const rejected = yield* Effect.either(work);
						expect(rejected._tag === "Left" && rejected.left).toBeInstanceOf(
							RuntimeCapabilityUnsupported,
						);
					}
					expect(f.calls).toEqual([]);
				}),
		);
	}
	it.effect(
		"requires an optional provider method as well as a supported capability",
		() =>
			Effect.gen(function* () {
				const f = fixture({}, false);
				const works: readonly Effect.Effect<unknown, RuntimeError>[] = [
					f.resources.listModels("c"),
					f.resources.listSessions("c"),
					f.resources.listResources("c", "a"),
				];
				for (const work of works) {
					const result = yield* Effect.either(work);
					expect(result._tag === "Left" && result.left._tag).toBe(
						"RuntimeCapabilityUnsupported",
					);
				}
			}),
	);
	it.effect(
		"preserves actual provider failures instead of inventing an empty remote catalog",
		() =>
			Effect.gen(function* () {
				const failure = new RuntimeAuthenticationFailed(
					new Error("Bearer private-token"),
				);
				const f = fixture({ listAgents: () => Effect.fail(failure) });
				const result = yield* f.resources.discover("c").pipe(Effect.either);
				expect(result._tag === "Left" && result.left._tag).toBe(
					"RuntimeAuthenticationFailed",
				);
				expect(result._tag === "Left" && result.left.code).toBe(
					"AGENT.HTTP.AUTH.FAILED",
				);
				expect(result._tag === "Left" && result.left.originalCause).toBe(
					failure.originalCause,
				);
				expect(JSON.stringify(result)).not.toContain("private-token");
			}),
	);
	it.effect("times out and cancels a stuck provider listing", () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			let cancelled = false;
			const f = fixture({
				listAgents: () =>
					Deferred.succeed(entered, undefined).pipe(
						Effect.zipRight(Effect.never),
						Effect.onInterrupt(() =>
							Effect.sync(() => {
								cancelled = true;
							}),
						),
					),
			});
			const call = yield* f.resources
				.discover("c")
				.pipe(Effect.either, Effect.fork);
			yield* Deferred.await(entered);
			yield* TestClock.adjust("10 seconds");
			const result = yield* Fiber.join(call);
			expect(result._tag === "Left" && result.left._tag).toBe("RuntimeTimeout");
			expect(cancelled).toBe(true);
		}),
	);
});

import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Redacted, Stream, TestClock } from "effect";
import type {
	RuntimeCapabilities,
	RuntimeHealth,
} from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeAuthenticationFailed,
	RuntimeConnectionInvalid,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import type { RuntimeProviderAdapter } from "../../../../../packages/edge/src/agent-http/runtime-ports.js";
import {
	createRuntimeRegistry,
	type RuntimeRegistrySnapshot,
	type RuntimeResolver,
} from "./runtime-registry.js";

const capabilities: RuntimeCapabilities = {
	health: "supported",
	chat: "supported",
	listAgents: "unsupported",
	sessions: "unverified",
	resources: "unsupported",
	models: "unsupported",
	toolEvents: "unsupported",
	usage: "unverified",
};
const ready: RuntimeHealth = {
	status: "ready",
	lifecycle: "externallyManaged",
};
const adapter = (
	health: RuntimeProviderAdapter["health"],
): RuntimeProviderAdapter => ({
	kind: "hermes",
	health,
	capabilities: () => Effect.succeed(capabilities),
	listAgents: () => Effect.succeed([]),
	streamConversation: () => Stream.empty,
});
const resolver =
	(provider: RuntimeProviderAdapter): RuntimeResolver =>
	(id) =>
		Effect.succeed({
			connection: {
				id,
				name: id,
				kind: "hermes",
				baseURL: "http://127.0.0.1:12345",
				credentialRef: "private-ref",
			},
			credential: Redacted.make("fixture-secret"),
			adapter: provider,
		});

describe("HTTP runtime registry", () => {
	it.effect(
		"stays offline until connect, polls with fresh resolution, disconnects without server control",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					let calls = 0;
					let resolutions = 0;
					const registry = yield* createRuntimeRegistry({
						pollIntervalMs: 1000,
						resolve: (id) =>
							Effect.sync(() => {
								resolutions++;
							}).pipe(
								Effect.zipRight(
									resolver(
										adapter(() =>
											Effect.sync(() => {
												calls++;
												return ready;
											}),
										),
									)(id),
								),
							),
					});
					const snapshots: RuntimeRegistrySnapshot[] = [];
					const off = registry.subscribe((next) => snapshots.push(next));
					expect(calls).toBe(0);
					expect(resolutions).toBe(0);
					expect(yield* registry.read()).toEqual({
						generation: 0,
						status: "disconnected",
					});
					expect((yield* registry.connect("one")).status).toBe("connected");
					expect(calls).toBe(1);
					yield* TestClock.adjust("1 second");
					expect(calls).toBe(2);
					expect(resolutions).toBe(2);
					yield* registry.disconnect();
					yield* TestClock.adjust("30 seconds");
					expect(calls).toBe(2);
					expect(yield* registry.read()).toMatchObject({
						status: "disconnected",
					});
					expect(JSON.stringify(snapshots)).not.toMatch(
						/private-ref|fixture-secret|credential/,
					);
					off();
				}),
			),
	);
	it.effect(
		"switching cancels an in-flight check and prevents old generation publication",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					const release = yield* Deferred.make<RuntimeHealth>();
					let interrupted = false;
					const registry = yield* createRuntimeRegistry({
						resolve: resolver(
							adapter((connection) =>
								connection.id === "old"
									? Deferred.succeed(entered, undefined).pipe(
											Effect.zipRight(Deferred.await(release)),
											Effect.onInterrupt(() =>
												Effect.sync(() => {
													interrupted = true;
												}),
											),
										)
									: Effect.succeed(ready),
							),
						),
					});
					const snapshots: RuntimeRegistrySnapshot[] = [];
					registry.subscribe((s) => snapshots.push(s));
					const old = yield* registry
						.connect("old")
						.pipe(Effect.either, Effect.fork);
					yield* Deferred.await(entered);
					const current = yield* registry.connect("new");
					expect(current.connectionId).toBe("new");
					expect(interrupted).toBe(true);
					expect((yield* Fiber.join(old))._tag).toBe("Left");
					yield* Deferred.succeed(release, ready);
					yield* Effect.yieldNow();
					expect((yield* registry.read()).connectionId).toBe("new");
					expect(
						snapshots
							.filter((s) => s.connectionId === "old")
							.map((s) => s.status),
					).toEqual(["connecting"]);
				}),
			),
	);
	it.effect(
		"caller interruption cancels health and leaves disconnected state",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					let interrupted = false;
					const registry = yield* createRuntimeRegistry({
						resolve: resolver(
							adapter(() =>
								Deferred.succeed(entered, undefined).pipe(
									Effect.zipRight(Effect.never),
									Effect.onInterrupt(() =>
										Effect.sync(() => {
											interrupted = true;
										}),
									),
								),
							),
						),
					});
					const call = yield* registry.connect("one").pipe(Effect.fork);
					yield* Deferred.await(entered);
					yield* Fiber.interrupt(call);
					expect(interrupted).toBe(true);
					expect((yield* registry.read()).status).toBe("disconnected");
				}),
			),
	);
	it.effect(
		"auth errors retain identity, pause polling and allow explicit refresh after recovery",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					let authenticated = false;
					let calls = 0;
					const original = new Error("Bearer fixture-secret");
					const failure = new RuntimeAuthenticationFailed(original);
					const registry = yield* createRuntimeRegistry({
						pollIntervalMs: 1000,
						resolve: resolver(
							adapter(() =>
								Effect.suspend(() => {
									calls++;
									return authenticated
										? Effect.succeed(ready)
										: Effect.fail(failure);
								}),
							),
						),
					});
					const result = yield* registry.connect("one").pipe(Effect.either);
					expect(result._tag === "Left" && result.left._tag).toBe(
						"RuntimeAuthenticationFailed",
					);
					expect(result._tag === "Left" && result.left.code).toBe(
						"AGENT.HTTP.AUTH.FAILED",
					);
					expect(result._tag === "Left" && result.left.originalCause).toBe(
						original,
					);
					expect(failure.originalCause).toBe(original);
					expect(JSON.stringify(failure)).not.toContain("fixture-secret");
					expect(yield* registry.read()).toMatchObject({
						status: "authenticationRequired",
						code: "AGENT.HTTP.AUTH.FAILED",
					});
					yield* TestClock.adjust("60 seconds");
					expect(calls).toBe(1);
					authenticated = true;
					expect((yield* registry.refresh()).status).toBe("connected");
				}),
			),
	);
	it.effect("bounds checks with a timeout and aborts provider work", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				let interrupted = false;
				const registry = yield* createRuntimeRegistry({
					healthTimeoutMs: 100,
					resolve: resolver(
						adapter(() =>
							Deferred.succeed(entered, undefined).pipe(
								Effect.zipRight(Effect.never),
								Effect.onInterrupt(() =>
									Effect.sync(() => {
										interrupted = true;
									}),
								),
							),
						),
					),
				});
				const call = yield* registry
					.connect("one")
					.pipe(Effect.either, Effect.fork);
				yield* Deferred.await(entered);
				yield* TestClock.adjust("100 millis");
				const result = yield* Fiber.join(call);
				expect(result._tag === "Left" && result.left._tag).toBe(
					"RuntimeTimeout",
				);
				expect(interrupted).toBe(true);
				expect(yield* registry.read()).toMatchObject({
					status: "error",
					code: "AGENT.HTTP.REQUEST.TIMEOUT",
				});
			}),
		),
	);
	it.effect(
		"closing scope aborts an active poll and prevents future connection work",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				let calls = 0;
				let interrupted = false;
				const registry = yield* Effect.scoped(
					Effect.gen(function* () {
						const registry = yield* createRuntimeRegistry({
							pollIntervalMs: 1000,
							resolve: resolver(
								adapter(() =>
									Effect.suspend(() => {
										calls++;
										return calls === 1
											? Effect.succeed(ready)
											: Deferred.succeed(entered, undefined).pipe(
													Effect.zipRight(Effect.never),
													Effect.onInterrupt(() =>
														Effect.sync(() => {
															interrupted = true;
														}),
													),
												);
									}),
								),
							),
						});
						yield* registry.connect("one");
						yield* TestClock.adjust("1 second");
						yield* Deferred.await(entered);
						return registry;
					}),
				);
				expect(interrupted).toBe(true);
				expect((yield* registry.connect("one").pipe(Effect.either))._tag).toBe(
					"Left",
				);
				expect((yield* registry.read()).status).toBe("disconnected");
			}),
	);
	it.effect(
		"rejects a mismatched adapter before touching provider health",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					let calls = 0;
					const registry = yield* createRuntimeRegistry({
						resolve: () =>
							Effect.succeed({
								connection: {
									id: "one",
									kind: "openclaw",
									name: "one",
									baseURL: "http://127.0.0.1:12345",
								},
								adapter: adapter(() =>
									Effect.sync(() => {
										calls++;
										return ready;
									}),
								),
							}),
					});
					const result = yield* registry.connect("one").pipe(Effect.either);
					expect(result._tag === "Left" && result.left).toBeInstanceOf(
						RuntimeConnectionInvalid,
					);
					expect(calls).toBe(0);
				}),
			),
	);
	it.effect(
		"interruption during replacement cleanup cannot orphan a polling worker",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const entered = yield* Deferred.make<void>();
					const cleaning = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					let calls = 0;
					const registry = yield* createRuntimeRegistry({
						pollIntervalMs: 1000,
						resolve: resolver(
							adapter((connection) =>
								connection.id === "old"
									? Deferred.succeed(entered, undefined).pipe(
											Effect.zipRight(Effect.never),
											Effect.ensuring(
												Deferred.succeed(cleaning, undefined).pipe(
													Effect.zipRight(Deferred.await(release)),
												),
											),
										)
									: Effect.sync(() => {
											calls++;
											return ready;
										}),
							),
						),
					});
					const old = yield* registry
						.connect("old")
						.pipe(Effect.either, Effect.fork);
					yield* Deferred.await(entered);
					const next = yield* registry.connect("new").pipe(Effect.fork);
					yield* Deferred.await(cleaning);
					yield* Fiber.interruptFork(next);
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.await(next);
					yield* Fiber.join(old);
					const stoppedAt = calls;
					yield* TestClock.adjust("30 seconds");
					expect(calls).toBe(stoppedAt);
					expect((yield* registry.read()).status).toBe("disconnected");
				}),
			),
	);
});

import { it as effectIt } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Option,
	Redacted,
	TestClock,
} from "effect";
import { describe, expect, it } from "vitest";
import type { AgentState } from "../../../../../packages/edge/src/agents/agents-contracts";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants";
import {
	AgentCredentialPort,
	AgentRuntimePort,
} from "../../../../../packages/edge/src/agents/agents-ports";
import { AgentStorage } from "../../../../../packages/edge/src/agents/agents-repository";
import { AgentsService } from "../../../../../packages/edge/src/agents/agents-service";
import { CredentialVault, MacOsKeychain } from "../credentials/keychain";
import { agentCredentialsFromVault } from "./credentials";

describe("agent write-only credential binding", () => {
	it("stores only through the existing vault, exposes availability and handles revoked credentials", async () => {
		const native = new Map<string, Redacted.Redacted<string>>();
		let reads = 0;
		const runtime = ManagedRuntime.make(
			CredentialVault.Default.pipe(
				Layer.provide(
					Layer.succeed(MacOsKeychain, {
						write: async (_namespace, account, secret) => {
							native.set(account, secret);
						},
						read: async (_namespace, account) => {
							reads++;
							return Option.fromNullable(native.get(account));
						},
						remove: async (_namespace, account) => {
							native.delete(account);
						},
					}),
				),
			),
		);
		try {
			const vault = await runtime.runPromise(CredentialVault);
			const binding = agentCredentialsFromVault(vault);
			const ref = await runtime.runPromise(
				binding.store(Redacted.make("private-agent-key")),
			);
			expect(await runtime.runPromise(binding.available(ref))).toBe(true);
			await runtime.runPromise(
				Effect.all(
					Array.from({ length: 20 }, () => binding.available(ref)),
					{ concurrency: "unbounded" },
				),
			);
			expect(reads).toBeLessThanOrEqual(1);
			expect(Redacted.value(native.get(ref) ?? Redacted.make(""))).toBe(
				"private-agent-key",
			);
			await runtime.runPromise(binding.remove(ref));
			expect(await runtime.runPromise(binding.available(ref))).toBe(false);
			expect(native.size).toBe(0);
		} finally {
			await runtime.dispose();
		}
	});
	it("preserves secure-store failure identity and private causes without returning secret text", async () => {
		const cause = new Error("apiKey=private-agent-key");
		const runtime = ManagedRuntime.make(
			CredentialVault.Default.pipe(
				Layer.provide(
					Layer.succeed(MacOsKeychain, {
						write: async () => {
							throw cause;
						},
						read: async () => Option.none(),
						remove: async () => {},
					}),
				),
			),
		);
		try {
			const vault = await runtime.runPromise(CredentialVault);
			const result = await runtime.runPromise(
				agentCredentialsFromVault(vault)
					.store(Redacted.make("private-agent-key"))
					.pipe(Effect.either),
			);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left") {
				expect(result.left.code).toBe("AGENT.CREDENTIAL.UNAVAILABLE");
				expect(result.left.originalCause).toMatchObject({
					_tag: "AiCredentialStoreFailed",
					originalCause: cause,
				});
				expect(JSON.stringify(result.left)).not.toContain("private-agent-key");
			}
		} finally {
			await runtime.dispose();
		}
	});
});

effectIt.effect(
	"expires external availability changes and invalidates a concurrent slow read on removal",
	() => {
		let present = true;
		let reads = 0;
		let delay = false;
		return Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			// The vault is the real revocation consumer. Its injected backend delays only synthetic reads.
			const backendLayer = CredentialVault.Default.pipe(
				Layer.provide(
					Layer.succeed(MacOsKeychain, {
						write: async () => {},
						remove: async () => {
							present = false;
						},
						read: () =>
							Effect.runPromise(
								Effect.gen(function* () {
									reads++;
									const value = present
										? Option.some(Redacted.make("synthetic-key"))
										: Option.none<Redacted.Redacted<string>>();
									if (delay) {
										yield* Deferred.succeed(entered, undefined);
										yield* Deferred.await(release);
									}
									return value;
								}),
							),
					}),
				),
			);
			yield* Effect.gen(function* () {
				const binding = agentCredentialsFromVault(yield* CredentialVault);
				const ref = yield* binding.store(Redacted.make("synthetic-key"));
				expect(yield* binding.available(ref)).toBe(true);
				present = false;
				expect(yield* binding.available(ref)).toBe(true);
				expect(reads).toBe(1);
				yield* TestClock.adjust("31 seconds");
				expect(yield* binding.available(ref)).toBe(false);
				expect(reads).toBe(2);
				present = true;
				delay = true;
				yield* TestClock.adjust("31 seconds");
				const pending = yield* Effect.fork(binding.available(ref));
				yield* Deferred.await(entered);
				yield* binding.remove(ref);
				yield* Deferred.succeed(release, undefined);
				expect(yield* Fiber.join(pending)).toBe(false);
				expect(yield* binding.available(ref)).toBe(false);
			}).pipe(Effect.provide(backendLayer));
		});
	},
);

it("shares one bounded availability read across inherited scopes and repeated real conductor snapshots", async () => {
	const native = new Map<string, Redacted.Redacted<string>>();
	let reads = 0;
	let state: AgentState = initialAgentState();
	const vaultLayer = CredentialVault.Default.pipe(
		Layer.provide(
			Layer.succeed(MacOsKeychain, {
				write: async (_namespace, ref, secret) => {
					native.set(ref, secret);
				},
				read: async (_namespace, ref) => {
					reads++;
					return Option.fromNullable(native.get(ref));
				},
				remove: async (_namespace, ref) => {
					native.delete(ref);
				},
			}),
		),
	);
	const runtime = ManagedRuntime.make(
		AgentsService.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AgentStorage, {
						read: () => Effect.succeed(Option.some(state)),
						write: (next) =>
							Effect.sync(() => {
								state = next;
							}),
					}),
					Layer.succeed(AgentRuntimePort, {
						available: false,
						initial: {
							available: false,
							status: "stopped",
							code: "AGENT.RUNTIME.UNAVAILABLE",
							operation: "none",
						},
						start: Effect.void,
						stop: Effect.void,
						restart: Effect.void,
						subscribe: () => () => {},
					}),
					Layer.effect(
						AgentCredentialPort,
						Effect.map(CredentialVault, agentCredentialsFromVault),
					).pipe(Layer.provide(vaultLayer)),
				),
			),
		),
	);
	try {
		await runtime.runPromise(
			AgentsService.request({
				type: "save-model",
				scope: "default",
				row: {
					id: "initial",
					provider: "openai",
					model: "synthetic",
					baseUrl: "https://provider.test",
					maxTokens: 42,
					role: "default",
				},
				secret: "synthetic-key",
				revision: 0,
			}),
		);
		for (const id of ["first", "second"]) {
			await runtime.runPromise(
				AgentsService.request({ type: "create", id, name: id, emoji: "" }),
			);
			await runtime.runPromise(
				AgentsService.request({
					type: "inherit",
					scope: id,
					enabled: false,
					revision: state.revision,
				}),
			);
		}
		const views = await runtime.runPromise(
			Effect.all(
				Array.from({ length: 10 }, () => AgentsService.view()),
				{ concurrency: "unbounded" },
			),
		);
		expect(reads).toBe(1);
		expect(
			views.every((view) =>
				Object.values(view.models).every((rows) =>
					rows.every((row) => row.credentialAvailable),
				),
			),
		).toBe(true);
		expect(JSON.stringify(views)).not.toContain("synthetic-key");
		expect(JSON.stringify(views)).not.toContain(
			state.models.default?.[0]?.credentialRef,
		);
	} finally {
		await runtime.dispose();
	}
});

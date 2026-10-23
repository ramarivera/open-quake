import {
	AiCompatibleAdapter,
	AiProviderService,
	AiRepository,
	type CompatibleAdapter,
	type CredentialRef,
	type InferenceRequest,
	MOCK_PROFILE,
	type NormalizedEvent,
	translateProviderFailure,
} from "@open-quake/edge/ai";
import {
	ConfigProvider,
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Redacted,
	Stream,
} from "effect";
import { describe, expect, it } from "vitest";
import {
	AiCredentialsFromVault,
	CredentialVault,
	KEYCHAIN_NAMESPACE,
	type KeychainBackend,
	MacOsKeychain,
} from "./keychain.js";

function fakeKeychain() {
	const entries = new Map<CredentialRef, Redacted.Redacted<string>>();
	const calls: string[] = [];
	const backend: KeychainBackend = {
		read: async (service, reference) => {
			expect(service).toBe(KEYCHAIN_NAMESPACE);
			calls.push("read");
			return Option.fromNullable(entries.get(reference));
		},
		write: async (service, reference, value) => {
			expect(service).toBe(KEYCHAIN_NAMESPACE);
			calls.push("write");
			entries.set(reference, value);
		},
		remove: async (service, reference) => {
			expect(service).toBe(KEYCHAIN_NAMESPACE);
			calls.push("remove");
			entries.delete(reference);
		},
	};
	return { backend, entries, calls };
}
const vaultLayer = (backend: KeychainBackend) =>
	CredentialVault.Default.pipe(
		Layer.provide(Layer.succeed(MacOsKeychain, backend)),
	);

describe("host credential references", () => {
	it("stores only through the injected Keychain and returns opaque references", async () => {
		const fake = fakeKeychain();
		const secret = Redacted.make(crypto.randomUUID());
		await Effect.runPromise(
			Effect.gen(function* () {
				const vault = yield* CredentialVault;
				const stored = yield* vault.store(secret);
				expect(stored.authGeneration).toBe(0);
				expect(JSON.stringify(stored)).not.toContain(Redacted.value(secret));
				expect(Redacted.value(yield* vault.resolve(stored.reference, 0))).toBe(
					Redacted.value(secret),
				);
				yield* vault.remove(stored.reference);
				const revoked = yield* Effect.either(
					vault.resolve(stored.reference, 0),
				);
				expect(Either.isLeft(revoked) && revoked.left.code).toBe(
					"AI.PROVIDER.AUTH_REVOKED",
				);
			}).pipe(Effect.provide(vaultLayer(fake.backend))),
		);
		expect(fake.entries.size).toBe(0);
		expect(fake.calls).toEqual(["write", "read", "remove"]);
	});

	it("rejects missing and stale credentials without substituting another reference", async () => {
		const fake = fakeKeychain();
		await Effect.runPromise(
			Effect.gen(function* () {
				const vault = yield* CredentialVault;
				const stored = yield* vault.store(Redacted.make(crypto.randomUUID()));
				fake.entries.clear();
				const missing = yield* Effect.either(
					vault.resolve(stored.reference, 0),
				);
				expect(Either.isLeft(missing) && missing.left.code).toBe(
					"AI.PROVIDER.AUTH_REQUIRED",
				);
				const stale = yield* Effect.either(vault.resolve(stored.reference, 1));
				expect(Either.isLeft(stale) && stale.left.code).toBe(
					"AI.PROVIDER.AUTH_REVOKED",
				);
			}).pipe(Effect.provide(vaultLayer(fake.backend))),
		);
		expect(fake.calls).toEqual(["write", "read"]);
	});

	it("retains each storage failure privately, scrubs serialization, and never falls back", async () => {
		for (const operation of ["read", "write", "remove"] as const) {
			const fake = fakeKeychain();
			const original = new Error(crypto.randomUUID(), {
				cause: new Error(crypto.randomUUID()),
			});
			const broken: KeychainBackend = {
				...fake.backend,
				[operation]: async () => {
					throw original;
				},
			};
			await Effect.runPromise(
				Effect.gen(function* () {
					const vault = yield* CredentialVault;
					if (operation === "write") {
						const result = yield* Effect.either(
							vault.store(Redacted.make(crypto.randomUUID())),
						);
						expect(
							Either.isLeft(result) && [
								result.left._tag,
								result.left.originalCause,
							],
						).toEqual(["AiCredentialStoreFailed", original]);
						expect(
							Either.isLeft(result) && JSON.stringify(result.left),
						).not.toContain(original.message);
					} else {
						const stored = yield* vault.store(
							Redacted.make(crypto.randomUUID()),
						);
						const result = yield* Effect.either(
							operation === "read"
								? vault.resolve(stored.reference, 0)
								: vault.remove(stored.reference),
						);
						expect(Either.isLeft(result) && result.left.code).toBe(
							"AI.CREDENTIAL.STORE_FAILED",
						);
						expect(Either.isLeft(result) && result.left.originalCause).toBe(
							original,
						);
						expect(
							Either.isLeft(result) && JSON.stringify(result.left),
						).not.toContain(original.message);
						if (operation === "remove") {
							const revoked = yield* Effect.either(
								vault.resolve(stored.reference, 0),
							);
							expect(Either.isLeft(revoked) && revoked.left.code).toBe(
								"AI.PROVIDER.AUTH_REVOKED",
							);
						}
					}
				}).pipe(Effect.provide(vaultLayer(broken))),
			);
			expect(fake.calls).toEqual(operation === "write" ? [] : ["write"]);
		}
	});

	it("drives Keychain references through the provider and aborts an active stream on removal", async () => {
		const fake = fakeKeychain();
		await Effect.runPromise(
			Effect.gen(function* () {
				const opened =
					yield* Deferred.make<Parameters<CompatibleAdapter["open"]>[0]>();
				const adapter: CompatibleAdapter = {
					open: (input) =>
						Deferred.succeed(opened, input).pipe(
							Effect.as(
								Stream.succeed<NormalizedEvent>({
									_tag: "textDelta",
									textDelta: "partial",
									kind: "generation",
								}).pipe(Stream.concat(Stream.never)),
							),
						),
				};
				const host = vaultLayer(fake.backend);
				const profileRepo = AiRepository.Default;
				const provider = AiProviderService.DefaultWithoutDependencies.pipe(
					Layer.provideMerge(profileRepo),
					Layer.provide(
						Layer.mergeAll(
							Layer.setConfigProvider(
								ConfigProvider.fromMap(
									new Map([["AI_PROVIDER_ADAPTER", "openai-compatible"]]),
								),
							),
							Layer.succeed(AiCompatibleAdapter, adapter),
							AiCredentialsFromVault.pipe(Layer.provide(host)),
						),
					),
				);
				yield* Effect.gen(function* () {
					const vault = yield* CredentialVault;
					const secret = Redacted.make(crypto.randomUUID());
					const stored = yield* vault.store(secret);
					yield* (yield* AiRepository).put({
						...MOCK_PROFILE,
						adapter: "openai-compatible",
						auth: "apiKey",
						credentialRef: stored.reference,
					});
					const request: InferenceRequest = {
						profileId: MOCK_PROFILE.id,
						messages: [
							{ role: "user", content: [{ _tag: "text", text: "hello" }] },
						],
						requestedCapabilities: [],
						sampling: {},
					};
					const generation = yield* (yield* AiProviderService).generate(
						request,
					);
					const consumer = yield* Stream.runCollect(generation.events).pipe(
						Effect.either,
						Effect.fork,
					);
					const outbound = yield* Deferred.await(opened);
					expect(Redacted.value(outbound.credential)).toBe(
						Redacted.value(secret),
					);
					expect(outbound.redirectPolicy).toBe("error");
					yield* vault.remove(stored.reference);
					const result = yield* Fiber.join(consumer);
					expect(Either.isLeft(result) && result.left.code).toBe(
						"AI.PROVIDER.AUTH_REVOKED",
					);
					expect(outbound.signal.aborted).toBe(true);
					expect(fake.calls).toEqual(["write", "read", "remove"]);
				}).pipe(Effect.provide(Layer.mergeAll(host, provider)));
			}),
		);
	});

	it("translates SDK statuses by code and preserves the original failure", () => {
		for (const [status, code] of [
			[401, "AI.PROVIDER.AUTH_REQUIRED"],
			[403, "AI.PROVIDER.AUTH_REQUIRED"],
			[429, "AI.PROVIDER.RATE_LIMITED"],
			[500, "AI.PROVIDER.UNAVAILABLE"],
		] as const) {
			const original = new Error(crypto.randomUUID());
			const error = translateProviderFailure(status, original);
			expect(error.code).toBe(code);
			expect(error.originalCause).toBe(original);
			expect(Object.keys(error)).not.toContain("originalCause");
			expect(JSON.stringify(error)).not.toContain(original.message);
		}
	});

	it("revokes immediately while an earlier Keychain read is still pending", async () => {
		const fake = fakeKeychain();
		await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const pending =
					yield* Deferred.make<Option.Option<Redacted.Redacted<string>>>();
				const backend: KeychainBackend = {
					...fake.backend,
					read: () =>
						Effect.runPromise(
							Deferred.succeed(started, undefined).pipe(
								Effect.zipRight(Deferred.await(pending)),
							),
						),
				};
				yield* Effect.gen(function* () {
					const vault = yield* CredentialVault;
					const stored = yield* vault.store(Redacted.make(crypto.randomUUID()));
					const read = yield* vault
						.resolve(stored.reference, 0)
						.pipe(Effect.either, Effect.fork);
					yield* Deferred.await(started);
					yield* vault.remove(stored.reference);
					const revoked = yield* Effect.either(
						vault.revoked(stored.reference, 0),
					);
					expect(Either.isLeft(revoked) && revoked.left.code).toBe(
						"AI.PROVIDER.AUTH_REVOKED",
					);
					yield* Deferred.succeed(
						pending,
						Option.some(Redacted.make(crypto.randomUUID())),
					);
					const late = yield* Fiber.join(read);
					expect(Either.isLeft(late) && late.left.code).toBe(
						"AI.PROVIDER.AUTH_REVOKED",
					);
				}).pipe(Effect.provide(vaultLayer(backend)));
			}),
		);
	});
});

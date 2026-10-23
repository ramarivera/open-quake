import {
	AiAuthRequired,
	AiAuthRevoked,
	AiCredentialStoreFailed,
	AiCredentials,
	type AiError,
	type CredentialRef,
} from "@open-quake/edge/ai";
import {
	Context,
	Deferred,
	Effect,
	Layer,
	Option,
	Redacted,
	Ref,
} from "effect";

export const KEYCHAIN_NAMESPACE = "org.open-quake.ai-provider.v1";

/** Native binding supplied at the application root. Never shell a secret through argv. */
export interface KeychainBackend {
	readonly read: (
		service: string,
		account: CredentialRef,
	) => Promise<Option.Option<Redacted.Redacted<string>>>;
	readonly write: (
		service: string,
		account: CredentialRef,
		secret: Redacted.Redacted<string>,
	) => Promise<void>;
	readonly remove: (service: string, account: CredentialRef) => Promise<void>;
}
export class MacOsKeychain extends Context.Tag(
	"@open-quake/desktop/MacOsKeychain",
)<MacOsKeychain, KeychainBackend>() {}

/** New credentials always receive a new reference. Removed references are never reused. */
export class CredentialVault extends Effect.Service<CredentialVault>()(
	"@open-quake/desktop/CredentialVault",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const backend = yield* MacOsKeychain;
			const lock = yield* Effect.makeSemaphore(1);
			const removed = yield* Ref.make<ReadonlySet<CredentialRef>>(new Set());
			const signals = yield* Ref.make<
				ReadonlyMap<CredentialRef, Deferred.Deferred<never, AiAuthRevoked>>
			>(new Map());
			const signal = (reference: CredentialRef) =>
				Effect.gen(function* () {
					const current = (yield* Ref.get(signals)).get(reference);
					if (current) return current;
					const created = yield* Deferred.make<never, AiAuthRevoked>();
					yield* Ref.update(signals, (all) =>
						new Map(all).set(reference, created),
					);
					return created;
				});
			const resolve = Effect.fn("CredentialVault.resolve")(function* (
				reference: CredentialRef,
				generation: number,
			): Effect.fn.Return<Redacted.Redacted<string>, AiError> {
				if (generation !== 0 || (yield* Ref.get(removed)).has(reference))
					return yield* new AiAuthRevoked();
				const secret = yield* Effect.tryPromise({
					try: () => backend.read(KEYCHAIN_NAMESPACE, reference),
					catch: (cause) => new AiCredentialStoreFailed(cause),
				});
				// Revocation must not wait for a slow Keychain read or expose its late result.
				if ((yield* Ref.get(removed)).has(reference))
					return yield* new AiAuthRevoked();
				if (
					Option.isNone(secret) ||
					Redacted.value(secret.value).trim().length === 0
				)
					return yield* new AiAuthRequired();
				return secret.value;
			});
			const revoked = Effect.fn("CredentialVault.revoked")(function* (
				reference: CredentialRef,
				generation: number,
			): Effect.fn.Return<never, AiError> {
				const pending = yield* lock.withPermits(1)(
					Effect.gen(function* () {
						if (generation !== 0 || (yield* Ref.get(removed)).has(reference))
							return yield* new AiAuthRevoked();
						return yield* signal(reference);
					}),
				);
				return yield* Deferred.await(pending);
			});
			return {
				resolve,
				revoked,
				store: Effect.fn("CredentialVault.store")(
					(
						secret: Redacted.Redacted<string>,
					): Effect.Effect<
						{ readonly reference: CredentialRef; readonly authGeneration: 0 },
						AiError
					> =>
						Effect.uninterruptible(
							Effect.gen(function* () {
								if (Redacted.value(secret).trim().length === 0)
									return yield* new AiAuthRequired();
								const reference = crypto.randomUUID() as CredentialRef;
								yield* Effect.tryPromise({
									try: () =>
										backend.write(KEYCHAIN_NAMESPACE, reference, secret),
									catch: (cause) => new AiCredentialStoreFailed(cause),
								});
								return { reference, authGeneration: 0 as const };
							}),
						),
				),
				remove: Effect.fn("CredentialVault.remove")(
					(reference: CredentialRef): Effect.Effect<void, AiError> =>
						Effect.uninterruptible(
							Effect.gen(function* () {
								yield* lock.withPermits(1)(
									Effect.gen(function* () {
										yield* Ref.update(removed, (all) =>
											new Set(all).add(reference),
										);
										yield* Deferred.fail(
											yield* signal(reference),
											new AiAuthRevoked(),
										);
									}),
								);
								// State is revoked before native deletion, including when deletion fails.
								yield* Effect.tryPromise({
									try: () => backend.remove(KEYCHAIN_NAMESPACE, reference),
									catch: (cause) => new AiCredentialStoreFailed(cause),
								});
							}),
						),
				),
			};
		}),
	},
) {}

/** Explicit host composition, with no default backend or plaintext fallback. */
export const AiCredentialsFromVault = Layer.effect(
	AiCredentials,
	Effect.map(CredentialVault, (vault) => ({
		resolve: vault.resolve,
		revoked: vault.revoked,
	})),
);

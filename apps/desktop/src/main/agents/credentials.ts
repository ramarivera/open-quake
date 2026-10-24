import { Effect, Schema } from "effect";
import { AgentCredentialUnavailable } from "../../../../../packages/edge/src/agents/agents-errors.js";
import type { AgentCredentialAdapter } from "../../../../../packages/edge/src/agents/agents-ports.js";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts.js";
import type { CredentialVault } from "../credentials/keychain";
/** Only main can adapt the existing native vault. Neither refs nor stored secrets enter renderer replies. */
export const agentCredentialsFromVault = (
	vault: CredentialVault,
): AgentCredentialAdapter => {
	// Cache booleans only. Unknown refs read once per 30 seconds, including concurrent
	// snapshot refreshes. The bound prevents stale references growing memory forever.
	const cache = new Map<
		string,
		{ read: Effect.Effect<boolean>; revoked: boolean }
	>();
	const lock = Effect.runSync(Effect.makeSemaphore(1));
	const invalidate = (reference: string) =>
		Effect.sync(() => {
			const entry = cache.get(reference);
			if (entry) entry.revoked = true;
			cache.delete(reference);
		});
	return {
		store: (secret) =>
			vault.store(secret).pipe(
				Effect.matchEffect({
					onSuccess: (result) =>
						invalidate(result.reference).pipe(Effect.as(result.reference)),
					onFailure: (cause) =>
						Effect.fail(new AgentCredentialUnavailable(cause)),
				}),
			),
		available: (reference) =>
			Effect.gen(function* () {
				const entry = yield* lock.withPermits(1)(
					Effect.gen(function* () {
						const existing = cache.get(reference);
						if (existing) return existing;
						const read = yield* Effect.cachedWithTTL(
							Schema.decodeUnknown(CredentialRef)(reference).pipe(
								Effect.flatMap((ref) => vault.resolve(ref, 0)),
								Effect.as(true),
								Effect.orElseSucceed(() => false),
							),
							"30 seconds",
						);
						const created = { read, revoked: false };
						if (cache.size >= 256) {
							const oldest = cache.keys().next().value;
							if (oldest !== undefined) cache.delete(oldest);
						}
						cache.set(reference, created);
						return created;
					}),
				);
				const available = yield* entry.read;
				return available && !entry.revoked;
			}),
		remove: (reference) =>
			invalidate(reference).pipe(
				Effect.zipRight(Schema.decodeUnknown(CredentialRef)(reference)),
				Effect.flatMap((ref) => vault.remove(ref)),
				Effect.matchEffect({
					onSuccess: () => Effect.void,
					onFailure: (cause) =>
						Effect.fail(new AgentCredentialUnavailable(cause)),
				}),
			),
	};
};

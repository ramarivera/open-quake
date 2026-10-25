import { Deferred, Effect, Redacted, Schema } from "effect";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import type { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	AiAuthRequired,
	AiAuthRevoked,
	AiCredentialStoreFailed,
	type AiError,
} from "../../../../../packages/edge/src/ai/ai-errors";
import type { CredentialVault as NativeVault } from "../../../../../packages/edge/src/channels/channel-contracts";
import type { CredentialVault } from "../credentials/keychain";

/** Reuses the app's existing safeStorage vault. No new keychain namespace or plaintext fallback. */
export const createSpeechCredentials = Effect.fn("DesktopSpeech.credentials")(
	function* (native: NativeVault) {
		const removed = new Set<CredentialRef>();
		const signals = new Map<
			CredentialRef,
			Deferred.Deferred<never, AiAuthRevoked>
		>();
		const resolve = Effect.fn("DesktopSpeech.resolveCredential")(function* (
			reference: CredentialRef,
			generation: number,
		): Effect.fn.Return<Redacted.Redacted<string>, AiError> {
			if (generation !== 0 || removed.has(reference))
				return yield* new AiAuthRevoked();
			const key = yield* Effect.tryPromise({
				try: () => native.get(reference),
				catch: (cause) =>
					cause instanceof Error && "code" in cause && cause.code === "ENOENT"
						? new AiAuthRequired(cause)
						: new AiCredentialStoreFailed(cause),
			}).pipe(
				Effect.timeoutFail({
					duration: "10 seconds",
					onTimeout: () => new AiCredentialStoreFailed(),
				}),
			);
			if (removed.has(reference)) return yield* new AiAuthRevoked();
			if (!key.trim()) return yield* new AiAuthRequired();
			return Redacted.make(key);
		});
		const revoked = Effect.fn("DesktopSpeech.credentialRevoked")(function* (
			reference: CredentialRef,
			generation: number,
		): Effect.fn.Return<never, AiError> {
			if (generation !== 0 || removed.has(reference))
				return yield* new AiAuthRevoked();
			let signal = signals.get(reference);
			if (!signal) {
				signal = yield* Deferred.make<never, AiAuthRevoked>();
				signals.set(reference, signal);
			}
			return yield* Deferred.await(signal);
		});
		const credentials: Pick<CredentialVault, "store" | "remove" | "resolve"> &
			typeof AiCredentials.Service = {
			resolve,
			revoked,
			store: Effect.fn("DesktopSpeech.storeCredential")((secret) =>
				Effect.gen(function* () {
					if (!Redacted.value(secret).trim())
						return yield* new AiAuthRequired();
					const reference = yield* Effect.tryPromise({
						try: () => native.put(Redacted.value(secret)),
						catch: (cause) => new AiCredentialStoreFailed(cause),
					});
					const decoded = yield* Schema.decodeUnknown(CredentialRef)(
						reference,
					).pipe(
						Effect.mapError((cause) => new AiCredentialStoreFailed(cause)),
					);
					return { reference: decoded, authGeneration: 0 as const };
				}),
			),
			remove: Effect.fn("DesktopSpeech.removeCredential")((reference) =>
				Effect.gen(function* () {
					removed.add(reference);
					const signal = signals.get(reference);
					if (signal) {
						yield* Deferred.fail(signal, new AiAuthRevoked());
						signals.delete(reference);
					}
					yield* Effect.tryPromise({
						try: () => native.remove(reference),
						catch: (cause) => new AiCredentialStoreFailed(cause),
					});
				}),
			),
		};
		return credentials;
	},
);

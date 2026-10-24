import { Effect, Schema } from "effect";
import { AgentCredentialUnavailable } from "../../../../../packages/edge/src/agents/agents-errors.js";
import type { AgentCredentialAdapter } from "../../../../../packages/edge/src/agents/agents-ports.js";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts.js";
import type { CredentialVault } from "../credentials/keychain";
/** Only main can adapt the existing native vault. Neither refs nor stored secrets enter renderer replies. */
export const agentCredentialsFromVault = (
	vault: CredentialVault,
): AgentCredentialAdapter => ({
	store: (secret) =>
		vault.store(secret).pipe(
			Effect.matchEffect({
				onSuccess: (result) => Effect.succeed(result.reference),
				onFailure: (cause) =>
					Effect.fail(new AgentCredentialUnavailable(cause)),
			}),
		),
	available: (reference) =>
		Schema.decodeUnknown(CredentialRef)(reference).pipe(
			Effect.flatMap((ref) => vault.resolve(ref, 0)),
			Effect.as(true),
			Effect.orElseSucceed(() => false),
		),
	remove: (reference) =>
		Schema.decodeUnknown(CredentialRef)(reference).pipe(
			Effect.flatMap((ref) => vault.remove(ref)),
			Effect.matchEffect({
				onSuccess: () => Effect.void,
				onFailure: (cause) =>
					Effect.fail(new AgentCredentialUnavailable(cause)),
			}),
		),
});

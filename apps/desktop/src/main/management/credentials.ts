import { Effect, Redacted } from "effect";
import { AgentCredentialUnavailable } from "../../../../../packages/edge/src/agents/agents-errors";
import type { AgentCredentialAdapter } from "../../../../../packages/edge/src/agents/agents-ports";
import { systemCredentialVault } from "../integrations/storage";
/** OS-backed safeStorage. Never fall back to plaintext when the keychain is unavailable. */
export function managementAgentCredentials(
	root: string,
): AgentCredentialAdapter {
	const vault = systemCredentialVault(root);
	return {
		store: (secret) =>
			Effect.tryPromise({
				try: () => vault.put(Redacted.value(secret)),
				catch: (cause) => new AgentCredentialUnavailable(cause),
			}),
		available: (reference) =>
			Effect.tryPromise({
				try: () => vault.get(reference),
				catch: (cause) => new AgentCredentialUnavailable(cause),
			}).pipe(
				Effect.as(true),
				Effect.catchTag("AgentCredentialUnavailable", () =>
					Effect.succeed(false),
				),
			),
		remove: (reference) =>
			Effect.tryPromise({
				try: () => vault.remove(reference),
				catch: (cause) => new AgentCredentialUnavailable(cause),
			}),
	};
}

import { Effect, Schema } from "effect";
import { AgentCredentialUnavailable } from "../../../../../packages/edge/src/agents/agents-errors";
import type { AgentCredentialAdapter } from "../../../../../packages/edge/src/agents/agents-ports";
import { CredentialRef } from "../../../../../packages/edge/src/ai/ai-contracts";
import type { CredentialVault } from "../../../../../packages/edge/src/channels/channel-contracts";
import { createSpeechCredentials } from "../speech/credentials";
/** One revocation registry shared by settings and inference over the existing protected vault. */
export const createModelCredentials = Effect.fn("DesktopChat.credentials")(
	function* (native: CredentialVault) {
		const ai = yield* createSpeechCredentials(native);
		const ref = (value: string) =>
			Schema.decodeUnknown(CredentialRef)(value).pipe(
				Effect.mapError((cause) => new AgentCredentialUnavailable(cause)),
			);
		const management: AgentCredentialAdapter = {
			store: (secret) =>
				ai.store(secret).pipe(
					Effect.map((result) => result.reference),
					Effect.mapError((cause) => new AgentCredentialUnavailable(cause)),
				),
			available: (reference) =>
				ref(reference).pipe(
					Effect.flatMap((value) => ai.resolve(value, 0)),
					Effect.as(true),
					Effect.orElseSucceed(() => false),
				),
			remove: (reference) =>
				ref(reference).pipe(
					Effect.flatMap((value) => ai.remove(value)),
					Effect.mapError((cause) => new AgentCredentialUnavailable(cause)),
				),
		};
		return { ai, management };
	},
);

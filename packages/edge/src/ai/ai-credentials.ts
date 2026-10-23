import { Context, type Effect, type Redacted } from "effect";
import type { CredentialRef } from "./ai-contracts.js";
import type { AiError } from "./ai-errors.js";

/** Host-only capability. Secrets never enter public Schema contracts. */
export class AiCredentials extends Context.Tag(
	"@open-quake/edge/AiCredentials",
)<
	AiCredentials,
	{
		readonly resolve: (
			reference: CredentialRef,
			generation: number,
		) => Effect.Effect<Redacted.Redacted<string>, AiError>;
		readonly revoked: (
			reference: CredentialRef,
			generation: number,
		) => Effect.Effect<never, AiError>;
	}
>() {}

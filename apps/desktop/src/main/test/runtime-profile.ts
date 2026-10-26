import { Effect, Either, Option, type Redacted, Schema } from "effect";
import { AgentState } from "../../../../../packages/edge/src/agents/agents-contracts";
import type { AgentStorageFailed } from "../../../../../packages/edge/src/agents/agents-errors";
import type { AgentStoragePort } from "../../../../../packages/edge/src/agents/agents-repository";
import type { ProviderProfile } from "../../../../../packages/edge/src/ai/ai-contracts";
import type { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	AiConfigInvalid,
	type AiError,
} from "../../../../../packages/edge/src/ai/ai-errors";
import { validateProfile } from "../../../../../packages/edge/src/ai/ai-invariants";
import { profileFromModel } from "../chat/host";

/** Read the saved row and existing credential owner; never seed or edit user state. */
export const readRuntimeProfile = Effect.fn("RuntimeAcceptance.readProfile")(
	function* (
		selection: {
			readonly scope: string;
			readonly rowId: string;
			readonly authorizedModel: string;
		},
		storage: Pick<AgentStoragePort, "read">,
		credentials: typeof AiCredentials.Service,
	): Effect.fn.Return<
		{
			readonly profile: ProviderProfile;
			readonly apiKey: Redacted.Redacted<string>;
		},
		AiError | AgentStorageFailed
	> {
		const stored = yield* storage.read();
		if (Option.isNone(stored)) return yield* new AiConfigInvalid();
		const state = yield* Schema.decodeUnknown(AgentState)(stored.value).pipe(
			Effect.mapError((cause) => new AiConfigInvalid(cause)),
		);
		const rows = state.models[selection.scope]?.filter(
			(row) => row.id === selection.rowId,
		);
		const row = rows?.[0];
		if (!row || rows?.length !== 1 || row.model !== selection.authorizedModel)
			return yield* new AiConfigInvalid();
		const profile = yield* Effect.try({
			try: () => profileFromModel(row),
			catch: (cause) => new AiConfigInvalid(cause),
		});
		if (Either.isLeft(validateProfile(profile)))
			return yield* new AiConfigInvalid();
		if (profile.auth !== "apiKey" || !profile.credentialRef)
			return yield* new AiConfigInvalid();
		const apiKey = yield* credentials.resolve(
			profile.credentialRef,
			profile.authGeneration,
		);
		return { profile, apiKey };
	},
);

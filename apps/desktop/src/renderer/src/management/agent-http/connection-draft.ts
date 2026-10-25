import type {
	RuntimeConnectionView,
	RuntimeKind,
} from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import { normalizeRuntimeBaseURL } from "../../../../../../../packages/edge/src/agent-http/runtime-invariants";

/** Transient form state. Never persist this object or include it in diagnostics. */
export interface ConnectionDraft {
	readonly name: string;
	readonly kind: RuntimeKind;
	readonly baseURL: string;
	readonly credential: string;
	readonly clearCredential: boolean;
}

export function endpointCredentialRequired(
	draft: ConnectionDraft,
	existing: RuntimeConnectionView | undefined,
): boolean {
	return Boolean(
		existing?.credentialAvailable &&
			(draft.kind !== existing.kind ||
				normalizeRuntimeBaseURL(draft.baseURL) !==
					normalizeRuntimeBaseURL(existing.baseURL)) &&
			!draft.credential &&
			!draft.clearCredential,
	);
}

export function canSaveConnection(
	draft: ConnectionDraft,
	existing: RuntimeConnectionView | undefined,
): boolean {
	return (
		draft.name.trim().length > 0 &&
		draft.name.trim().length <= 120 &&
		normalizeRuntimeBaseURL(draft.baseURL) !== undefined &&
		!endpointCredentialRequired(draft, existing)
	);
}

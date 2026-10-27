import type { AssistantSettings } from "../../../../../../../packages/device/src/profiles/assistant-contracts";
import {
	ownModelRows,
	resolveModelRows,
} from "../../../../../../../packages/edge/src/agents/agents-invariants";
import type { PublicModelRow } from "../../../../shared/agents";
import { reconcileAssistantProvider } from "../../../../shared/assistant-provider";

/** Direct chat submits under the main agent scope, which may override defaults. */
export const DIRECT_CHAT_SCOPE = "main";

export interface DirectChatModel {
	/** The row the host will use, if one is configured. */
	readonly row: PublicModelRow | undefined;
	/** The host will accept a submission: configured row with a saved credential. */
	readonly ready: boolean;
}

/** Mirrors host resolution: the main agent's own rows, else the global default. */
export function directChatModel(
	models: Readonly<Record<string, readonly PublicModelRow[]>> | undefined,
	settings?: AssistantSettings,
	sessionPersona = false,
): DirectChatModel {
	const rows =
		(models &&
			(settings?.modelRowId || sessionPersona
				? ownModelRows(models, "default")
				: (ownModelRows(models, DIRECT_CHAT_SCOPE) ??
					ownModelRows(models, "default")))) ??
		[];
	const selected = resolveModelRows(rows).find((item) =>
		settings?.modelRowId
			? item.id === settings.modelRowId
			: item.role === "default",
	);
	const effective = settings && reconcileAssistantProvider(settings, selected);
	const row =
		selected && effective?.modelId
			? { ...selected, model: effective.modelId }
			: selected;
	return { row, ready: Boolean(row?.credentialAvailable) };
}

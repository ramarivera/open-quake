import { ownModelRows } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import type { PublicModelRow } from "../../../../shared/agents";

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
): DirectChatModel {
	const rows =
		(models &&
			(ownModelRows(models, DIRECT_CHAT_SCOPE) ??
				ownModelRows(models, "default"))) ??
		[];
	const row = rows.find(
		(item) =>
			item.role === "default" && item.provider.trim() && item.model.trim(),
	);
	return { row, ready: Boolean(row?.credentialAvailable) };
}

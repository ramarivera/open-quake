import type { PublicModelRow } from "../../../../shared/agents";

/** Apply committed field changes while preserving edits made against the previous snapshot. */
export function reconcileModelRow(
	draft: PublicModelRow,
	previous: PublicModelRow,
	next: PublicModelRow,
): PublicModelRow {
	return {
		id: draft.id,
		role: draft.role === previous.role ? next.role : draft.role,
		provider:
			draft.provider === previous.provider ? next.provider : draft.provider,
		model: draft.model === previous.model ? next.model : draft.model,
		baseUrl: draft.baseUrl === previous.baseUrl ? next.baseUrl : draft.baseUrl,
		maxTokens:
			draft.maxTokens === previous.maxTokens ? next.maxTokens : draft.maxTokens,
		credentialAvailable: next.credentialAvailable,
	};
}
export function reconcileModelDrafts(
	drafts: readonly PublicModelRow[],
	previous: readonly PublicModelRow[],
	next: readonly PublicModelRow[],
): readonly PublicModelRow[] {
	const merged = drafts.flatMap((draft) => {
		const before = previous.find((row) => row.id === draft.id);
		const saved = next.find((row) => row.id === draft.id);
		if (!saved) return before ? [] : [draft];
		return [
			before
				? reconcileModelRow(draft, before, saved)
				: { ...draft, credentialAvailable: saved.credentialAvailable },
		];
	});
	return [
		...merged,
		...next.filter((saved) => !drafts.some((draft) => draft.id === saved.id)),
	];
}

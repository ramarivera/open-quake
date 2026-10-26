import { providerSamplingValid } from "../../../../../../../packages/edge/src/ai/ai-sampling";
import type { PublicModelRow } from "../../../../shared/agents";

/** Apply committed field changes while preserving edits made against the previous snapshot. */
export function reconcileModelRow(
	draft: PublicModelRow,
	previous: PublicModelRow,
	next: PublicModelRow,
): PublicModelRow {
	const temperature =
		draft.temperature === previous.temperature
			? next.temperature
			: draft.temperature;
	const topP = draft.topP === previous.topP ? next.topP : draft.topP;
	return {
		...(temperature === undefined ? {} : { temperature }),
		...(topP === undefined ? {} : { topP }),
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

/** Empty numeric fields omit overrides. Invalid browser number input must not become a default. */
export function samplingInput(
	value: string,
	badInput = false,
): number | undefined {
	return badInput
		? Number.NaN
		: value.trim() === ""
			? undefined
			: Number(value);
}
export function samplingValid(
	row: Pick<PublicModelRow, "provider" | "model" | "temperature" | "topP">,
): boolean {
	return (
		providerSamplingValid(row) &&
		(row.temperature === undefined ||
			(Number.isFinite(row.temperature) &&
				row.temperature >= 0 &&
				row.temperature <= 2)) &&
		(row.topP === undefined ||
			(Number.isFinite(row.topP) && row.topP >= 0 && row.topP <= 1))
	);
}

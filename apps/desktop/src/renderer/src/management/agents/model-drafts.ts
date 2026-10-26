import { providerSamplingValid } from "../../../../../../../packages/edge/src/ai/ai-sampling";
import {
	canonicalProvider,
	migrateLegacySelection,
	supportsWebSearch,
} from "../../../../../../../packages/edge/src/ai/provider-catalog";
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
	const settings =
		JSON.stringify(draft.settings) === JSON.stringify(previous.settings)
			? next.settings
			: draft.settings;
	const controls =
		JSON.stringify(draft.controls) === JSON.stringify(previous.controls)
			? next.controls
			: draft.controls;
	return {
		...(temperature === undefined ? {} : { temperature }),
		...(topP === undefined ? {} : { topP }),
		...(settings === undefined ? {} : { settings }),
		...(controls === undefined ? {} : { controls }),
		id: draft.id,
		...(next.builtIn === undefined ? {} : { builtIn: next.builtIn }),
		...((draft.name === previous.name ? next.name : draft.name) === undefined
			? {}
			: { name: draft.name === previous.name ? next.name : draft.name }),
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

/** Apply an explicit Qwen generation selection to the editable row. */
export function selectQwenGeneration(
	row: PublicModelRow,
	kind: "chat" | "image" | "video",
): PublicModelRow {
	if ((row.settings?.mediaKind ?? "chat") === kind) return row;
	return {
		...row,
		model:
			kind === "image"
				? "wanx2.1-t2i-turbo"
				: kind === "video"
					? "wan2.2-t2v-plus"
					: "qwen3.6-plus",
		settings: {
			...row.settings,
			mediaKind: kind === "chat" ? undefined : kind,
		},
		baseUrl:
			kind === "chat"
				? "https://dashscope.aliyuncs.com/compatible-mode/v1"
				: "https://dashscope.aliyuncs.com/api/v1",
	};
}

/** Apply a provider edit without carrying controls for a different protocol. */
export function selectModelProvider(
	row: PublicModelRow,
	provider: string,
): PublicModelRow {
	const changed =
		canonicalProvider(row.provider) !== canonicalProvider(provider);
	const { controls: _controls, settings: _settings, ...metadata } = row;
	return {
		...(changed ? metadata : row),
		provider,
		model: migrateLegacySelection({ provider, modelId: row.model }).modelId,
	};
}

/** A model edit cannot retain a search control that its request policy rejects. */
export function selectModelId(
	row: PublicModelRow,
	model: string,
	provider = row.provider,
): PublicModelRow {
	const selected = { ...selectModelProvider(row, provider), model };
	if (supportsWebSearch(provider, model) || !selected.controls) return selected;
	const {
		webSearch: _search,
		searchOptions: _options,
		searchQuery: _query,
		...controls
	} = selected.controls;
	return { ...selected, controls };
}

/** A clone gets a fresh identity and no credential readiness or secret input. */
export function copyModelRow(row: PublicModelRow, id: string): PublicModelRow {
	return structuredClone({
		...row,
		id,
		role: "none",
		builtIn: false,
		name: `${row.name ?? row.model} copy`.slice(0, 30),
		credentialAvailable: false,
	});
}

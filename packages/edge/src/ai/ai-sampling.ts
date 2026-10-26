/** One provider policy for saved models, editor drafts and inference preparation.
 * OpenAI's documented GPT-4o and GPT-4.1 text models accept both controls. Preserve the
 * existing default-only policy for reasoning and unqualified OpenAI models.
 * This list describes request parameters, not model availability.
 */
export function providerSamplingValid(row: {
	readonly provider: string;
	readonly model: string;
	readonly temperature?: number | undefined;
	readonly topP?: number | undefined;
}): boolean {
	if (row.temperature === undefined && row.topP === undefined) return true;
	if (row.provider === "openai")
		return /^gpt-(?:4o(?:-mini)?|4\.1(?:-mini|-nano)?)(?:-\d{4}-\d{2}-\d{2})?$/.test(
			row.model,
		);
	if (row.provider === "kimi") {
		const temperature =
			row.model === "kimi-k2.5"
				? 0.6
				: row.model === "kimi-k2.6"
					? 1
					: undefined;
		return (
			temperature !== undefined &&
			(row.temperature === undefined || row.temperature === temperature) &&
			(row.topP === undefined || row.topP === 0.95)
		);
	}
	return true;
}

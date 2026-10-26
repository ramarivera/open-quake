import { expect, it } from "vitest";
import { providerSamplingValid } from "./ai-sampling.js";

it.each([
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4o-2024-08-06",
	"gpt-4o-mini-2024-07-18",
	"gpt-4.1",
	"gpt-4.1-mini",
	"gpt-4.1-nano-2025-04-14",
])("allows documented OpenAI text sampling for %s", (model) => {
	expect(
		providerSamplingValid({
			provider: "openai",
			model,
			temperature: 0,
			topP: 1,
		}),
	).toBe(true);
});

it.each(["gpt-5.1", "gpt-6.1-sol", "o3", "unknown", "gpt-4o-audio-preview"])(
	"requires defaults for unqualified OpenAI model %s",
	(model) => {
		expect(providerSamplingValid({ provider: "openai", model })).toBe(true);
		for (const sampling of [{ temperature: 0 }, { topP: 1 }])
			expect(
				providerSamplingValid({ provider: "openai", model, ...sampling }),
			).toBe(false);
	},
);

it("retains the exact mandatory Kimi values and generic provider controls", () => {
	for (const [model, temperature] of [
		["kimi-k2.5", 0.6],
		["kimi-k2.6", 1],
	] as const) {
		expect(
			providerSamplingValid({
				provider: "kimi",
				model,
				temperature,
				topP: 0.95,
			}),
		).toBe(true);
		expect(
			providerSamplingValid({ provider: "kimi", model, temperature: 0 }),
		).toBe(false);
		expect(providerSamplingValid({ provider: "kimi", model, topP: 1 })).toBe(
			false,
		);
	}
	expect(
		providerSamplingValid({
			provider: "generic",
			model: "custom",
			temperature: 0,
			topP: 1,
		}),
	).toBe(true);
});

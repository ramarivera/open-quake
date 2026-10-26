import { expect, it } from "vitest";
import type { PublicModelRow } from "../../../../shared/agents";
import {
	reconcileModelDrafts,
	reconcileModelRow,
	samplingInput,
	samplingValid,
} from "./model-drafts";

const first: PublicModelRow = {
	id: "saved",
	role: "default",
	provider: "openai",
	model: "saved-model",
	baseUrl: "https://synthetic.test",
	maxTokens: 4096,
	credentialAvailable: false,
};
it("retains new rows and unsaved fields while applying committed roles and credentials", () => {
	const draft: PublicModelRow = {
		...first,
		id: "draft",
		role: "none",
		model: "pending-model",
	};
	expect(
		reconcileModelDrafts(
			[{ ...first, model: "edited-model" }, draft],
			[first],
			[{ ...first, role: "fallback", credentialAvailable: true }],
		),
	).toEqual([
		{
			...first,
			model: "edited-model",
			role: "fallback",
			credentialAvailable: true,
		},
		draft,
	]);
});
it("removes committed deletions and includes externally added rows without dropping other drafts", () => {
	const draft: PublicModelRow = { ...first, id: "draft", role: "none" };
	const added: PublicModelRow = { ...first, id: "external" };
	expect(reconcileModelDrafts([first, draft], [first], [added])).toEqual([
		draft,
		added,
	]);
});
it("applies the save acknowledgement without overwriting edits made while it was pending", () => {
	expect(
		reconcileModelRow({ ...first, model: "newer-edit" }, first, {
			...first,
			model: "normalized",
			credentialAvailable: true,
		}),
	).toEqual({ ...first, model: "newer-edit", credentialAvailable: true });
});

it("keeps newer sampling edits and clearing across an older save acknowledgement", () => {
	const previous = { ...first, temperature: 0.4, topP: 0.8 };
	const saved = { ...previous, temperature: 0.6, topP: 0.9 };
	expect(
		reconcileModelRow(
			{ ...previous, temperature: 1.2, topP: undefined },
			previous,
			saved,
		),
	).toEqual({ ...first, temperature: 1.2 });
	expect(reconcileModelRow(previous, previous, saved)).toEqual(saved);
});
it("distinguishes blank defaults from invalid numbers and accepts inclusive bounds", () => {
	expect(samplingInput("")).toBeUndefined();
	expect(samplingInput("0")).toBe(0);
	expect(samplingInput("", true)).toBeNaN();
	for (const row of [
		{},
		{ temperature: 0, topP: 0 },
		{ temperature: 2, topP: 1 },
	])
		expect(samplingValid({ ...first, provider: "generic", ...row })).toBe(true);
	for (const row of [
		{ temperature: -0.1 },
		{ temperature: 2.1 },
		{ temperature: Number.NaN },
		{ topP: 1.1 },
		{ topP: Number.POSITIVE_INFINITY },
	])
		expect(samplingValid({ ...first, provider: "generic", ...row })).toBe(
			false,
		);
});

it("blocks unsupported model sampling before every row save while allowing clearing", () => {
	for (const model of ["gpt-5.1", "o3", "unknown"]) {
		expect(samplingValid({ ...first, model })).toBe(true);
		expect(samplingValid({ ...first, model, temperature: 0 })).toBe(false);
		expect(samplingValid({ ...first, model, topP: 1 })).toBe(false);
	}
	expect(
		samplingValid({ ...first, model: "gpt-4o", temperature: 0, topP: 1 }),
	).toBe(true);
	expect(
		samplingValid({
			...first,
			provider: "kimi",
			model: "kimi-k2.5",
			temperature: 0,
		}),
	).toBe(false);
});

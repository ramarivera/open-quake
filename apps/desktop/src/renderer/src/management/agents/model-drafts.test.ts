import { expect, it } from "vitest";
import type { PublicModelRow } from "../../../../shared/agents";
import { reconcileModelDrafts, reconcileModelRow } from "./model-drafts";

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

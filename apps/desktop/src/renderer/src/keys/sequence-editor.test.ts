import { Schema } from "effect";
import { expect, it } from "vitest";
import { ProfileJsonObject } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { changeSequenceStep } from "./SequenceEditor";

it("preserves imported step and config fields while editing a value or gap", () => {
	const step = Schema.decodeUnknownSync(ProfileJsonObject)({
		editorId: "stable-row",
		vendor: { retained: true },
		config: {
			type: "text",
			actions: [{ type: "text", value: "before" }],
			gap: 200,
			vendorOption: { synthetic: true },
		},
	});
	const changed = changeSequenceStep(step, {
		type: "text",
		actions: [{ type: "text", value: "after" }],
		gap: 450,
	});
	expect(changed).toMatchObject({
		editorId: "stable-row",
		vendor: { retained: true },
		config: {
			type: "text",
			actions: [{ type: "text", value: "after" }],
			gap: 450,
			vendorOption: { synthetic: true },
		},
	});
});

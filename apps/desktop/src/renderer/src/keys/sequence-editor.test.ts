import { Schema } from "effect";
import { expect, it } from "vitest";
import { ProfileJsonObject } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { changeSequenceStep, changeSequenceValue } from "./SequenceEditor";

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

it("changes only the first value while retaining every action and imported field", () => {
	const step = Schema.decodeUnknownSync(ProfileJsonObject)({
		editorId: "stable",
		vendorStep: { retained: true },
		config: {
			type: "text",
			gap: 250,
			vendorConfig: { retained: true },
			actions: [
				{ type: "text", value: "before", vendorAction: { first: true } },
				{ type: "key", value: "enter", vendorAction: { second: true } },
				{ type: "future", value: 42, retained: ["opaque"] },
			],
		},
	});
	const changed = changeSequenceValue(step, "after");
	expect(changed).toEqual({
		editorId: "stable",
		vendorStep: { retained: true },
		config: {
			type: "text",
			gap: 250,
			vendorConfig: { retained: true },
			actions: [
				{ type: "text", value: "after", vendorAction: { first: true } },
				{ type: "key", value: "enter", vendorAction: { second: true } },
				{ type: "future", value: 42, retained: ["opaque"] },
			],
		},
	});
	expect(changeSequenceStep(changed, { gap: 450 })).toMatchObject({
		config: {
			gap: 450,
			actions: [
				{ type: "text", value: "after", vendorAction: { first: true } },
				{ type: "key", value: "enter", vendorAction: { second: true } },
				{ type: "future", value: 42, retained: ["opaque"] },
			],
		},
	});
	expect(step).toMatchObject({
		config: {
			actions: [{ value: "before" }, { value: "enter" }, { value: 42 }],
		},
	});
});

it("keeps numeric delay values numeric and retains trailing actions", () => {
	const step = Schema.decodeUnknownSync(ProfileJsonObject)({
		config: {
			type: "delay",
			actions: [
				{ type: "time", value: 1000, retained: true },
				{ type: "future", value: "opaque" },
			],
		},
	});
	expect(changeSequenceValue(step, "2000")).toMatchObject({
		config: {
			actions: [
				{ type: "time", value: 2000, retained: true },
				{ type: "future", value: "opaque" },
			],
		},
	});
});

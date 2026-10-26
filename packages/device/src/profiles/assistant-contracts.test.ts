import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	AssistantSettings,
	assistantSettingsFromActions,
	defaultAssistantSettings,
} from "./assistant-contracts";

describe("AI-009/041/054/055/056/057/060 assistant settings", () => {
	it("round trips every retained default without credential fields", () => {
		const defaults = defaultAssistantSettings();
		expect(
			Schema.decodeUnknownSync(AssistantSettings)(
				Schema.encodeSync(AssistantSettings)(defaults),
			),
		).toEqual(defaults);
		expect(defaults).toMatchObject({
			contextTimeoutSeconds: 5,
			topP: 0.7,
			temperature: 1,
			chatHistoryCount: 0,
			enableVoiceInput: true,
			enableWakeTalkWindow: false,
			webSearch: false,
			entityIds: [],
		});
		expect(
			Schema.decodeUnknownEither(AssistantSettings, {
				onExcessProperty: "error",
			})({ ...defaults, apiKey: "never-store" })._tag,
		).toBe("Left");
	});
	it.each([
		{ contextTimeoutSeconds: 4 },
		{ contextTimeoutSeconds: 31 },
		{ contextTimeoutSeconds: 7 },
		{ temperature: 2.01 },
		{ topP: -0.01 },
		{ customPrompt: "a".repeat(3001), roleId: -1 },
		{ roleId: 65 },
		{ roleId: 122 },
		{ roleId: 124 },
		{ roleId: 125 },
		{ useAgent: true, enableVoiceInput: false },
		{ useAgent: true, enableWakeTalkWindow: true },
		{ chatHistoryCount: 51 },
		{ entityIds: ["not-an-entity"] },
	])("rejects invalid setting %j", (patch) => {
		expect(
			Schema.is(AssistantSettings)({ ...defaultAssistantSettings(), ...patch }),
		).toBe(false);
	});
	it.each([5, 10, 15, 20, 25, 30])("accepts timeout %i seconds", (seconds) =>
		expect(
			Schema.is(AssistantSettings)({
				...defaultAssistantSettings(),
				contextTimeoutSeconds: seconds,
			}),
		).toBe(true),
	);
});

it("MGMT-285 retains imported role/search/thinking before the first typed save", () => {
	expect(
		assistantSettingsFromActions([
			{ type: "roleConfig", value: { roleId: 128, rolePrompt: "Preset" } },
			{ type: "enableThinking", value: true },
		]),
	).toMatchObject({
		roleId: 128,
		thinking: true,
		webSearch: false,
		customPrompt: "",
	});
});

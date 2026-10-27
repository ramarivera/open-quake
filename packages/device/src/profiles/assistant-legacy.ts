import { Schema } from "effect";
import {
	AssistantSettings,
	defaultAssistantSettings,
} from "./assistant-contracts.js";

/** Review preview only. Imported endpoints, credentials and execution grants never migrate. */
export function previewLegacyAssistant(input: unknown): AssistantSettings {
	let raw: unknown = input;
	if (typeof raw === "string") {
		try {
			raw = JSON.parse(raw);
		} catch {
			raw = {};
		}
	}
	const legacy = Schema.decodeUnknownEither(
		Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	)(raw);
	if (legacy._tag === "Left")
		return {
			...defaultAssistantSettings(),
			useAgent: false,
			enableWakeTalkWindow: true,
		};
	const source = legacy.right;
	const next = {
		...defaultAssistantSettings(),
		useAgent: false,
		homeAssistantControl: false,
		enableVoiceInput: source.enableVoiceInput !== false,
		enableWakeTalkWindow: source.enableWakeTalkWindow !== false,
		modelId:
			typeof source.customModelName === "string" && source.customModelName
				? source.customModelName
				: typeof source.aiModelType === "string"
					? source.aiModelType
					: "",
		chatHistoryCount:
			typeof source.chatHistoryCount === "number" ? source.chatHistoryCount : 0,
		roleId:
			source.useCustomPrompt === true
				? -1
				: typeof source.systemRoleIdx === "number"
					? source.systemRoleIdx
					: 0,
		customPrompt:
			source.useCustomPrompt === true && typeof source.systemPrompt === "string"
				? source.systemPrompt
				: "",
		...(source.useCustomPrompt !== true &&
		typeof source.systemPrompt === "string"
			? { rolePrompt: source.systemPrompt }
			: {}),
		temperature:
			typeof source.roleTemperature === "number" ? source.roleTemperature : 1,
		topP: typeof source.roleTopP === "number" ? source.roleTopP : 0.7,
	};
	return Schema.is(AssistantSettings)(next)
		? next
		: {
				...defaultAssistantSettings(),
				useAgent: false,
				enableWakeTalkWindow: true,
			};
}

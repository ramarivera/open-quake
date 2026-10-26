import { Schema } from "effect";

/** Portable per-key settings. Credentials live only in host model/speech stores. */
export const AssistantSettings = Schema.Struct({
	version: Schema.Literal(1),
	modelRowId: Schema.String.pipe(Schema.maxLength(200)),
	modelId: Schema.String.pipe(Schema.maxLength(200)),
	useAgent: Schema.Boolean,
	enableVoiceInput: Schema.Boolean,
	enableWakeTalkWindow: Schema.Boolean,
	chatHistoryCount: Schema.Int.pipe(Schema.between(0, 50)),
	contextTimeoutSeconds: Schema.Int.pipe(
		Schema.between(5, 30),
		Schema.filter((n) => n % 5 === 0),
	),
	roleId: Schema.Int.pipe(
		Schema.between(-1, 129),
		Schema.filter((n) => ![65, 122, 124, 125].includes(n)),
	),
	customPrompt: Schema.String.pipe(Schema.maxLength(3000)),
	temperature: Schema.Finite.pipe(Schema.between(0, 2)),
	topP: Schema.Finite.pipe(Schema.between(0, 1)),
	thinking: Schema.Boolean,
	webSearch: Schema.Boolean,
	homeAssistantControl: Schema.Boolean,
	entityIds: Schema.Array(
		Schema.String.pipe(Schema.pattern(/^[a-z_]+\.[a-z0-9_]+$/)),
	).pipe(Schema.maxItems(500)),
}).pipe(
	Schema.filter(
		(s) =>
			(!s.useAgent || (s.enableVoiceInput && !s.enableWakeTalkWindow)) &&
			(s.roleId === -1 || s.customPrompt === "") &&
			new Set(s.entityIds).size === s.entityIds.length,
	),
);
export type AssistantSettings = typeof AssistantSettings.Type;
export const defaultAssistantSettings = (): AssistantSettings => ({
	version: 1,
	modelRowId: "",
	modelId: "",
	useAgent: true,
	enableVoiceInput: true,
	enableWakeTalkWindow: false,
	chatHistoryCount: 0,
	contextTimeoutSeconds: 5,
	roleId: 0,
	customPrompt: "",
	temperature: 1,
	topP: 0.7,
	thinking: false,
	webSearch: false,
	homeAssistantControl: false,
	entityIds: [],
});

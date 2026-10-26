import { Schema } from "effect";

export const ModelRole = Schema.Literal(
	"routing",
	"daily",
	"deepThink",
	"vision",
	"image",
	"video",
	"tts",
);
export type ModelRole = typeof ModelRole.Type;
export const ModelRoles = Schema.Struct({
	routing: Schema.optional(Schema.NonEmptyTrimmedString),
	daily: Schema.optional(Schema.NonEmptyTrimmedString),
	deepThink: Schema.optional(Schema.NonEmptyTrimmedString),
	vision: Schema.optional(Schema.NonEmptyTrimmedString),
	image: Schema.optional(Schema.NonEmptyTrimmedString),
	video: Schema.optional(Schema.NonEmptyTrimmedString),
	tts: Schema.optional(Schema.NonEmptyTrimmedString),
});
export const ProviderKind = Schema.Literal(
	"generic",
	"openai",
	"qwen",
	"kimi",
	"deepseek",
	"zhipu",
	"groq",
	"volc",
	"coze",
	"xfy",
);
export const SearchOptions = Schema.Struct({
	search_strategy: Schema.optional(Schema.Literal("standard", "pro")),
	enable_source: Schema.optional(Schema.Boolean),
	enable_citation: Schema.optional(Schema.Boolean),
	forced_search: Schema.optional(Schema.Boolean),
});
export const GenerationControls = Schema.Struct({
	thinking: Schema.optional(Schema.Boolean),
	reasoningEffort: Schema.optional(Schema.Literal("low", "medium", "high")),
	webSearch: Schema.optional(Schema.Boolean),
	searchOptions: Schema.optional(SearchOptions),
	searchQuery: Schema.optional(Schema.String.pipe(Schema.maxLength(4096))),
});
export type GenerationControls = typeof GenerationControls.Type;
/** Custom text belongs to role -1; preset prompts must not discard caller input. */
export const RoleSelection = Schema.Struct({
	roleId: Schema.Int.pipe(Schema.greaterThanOrEqualTo(-1)),
	locale: Schema.Literal("en", "zh", "ja", "ko", "de", "fr", "es", "it"),
	customPrompt: Schema.optional(Schema.String.pipe(Schema.maxLength(3000))),
}).pipe(
	Schema.filter(
		(selection) =>
			selection.roleId === -1 || selection.customPrompt === undefined,
	),
);
/** A closed wire-options contract; secrets and arbitrary provider keys cannot enter it. */
export const ProviderOptions = Schema.Struct({
	max_completion_tokens: Schema.optional(Schema.Number),
	search_options: Schema.optional(SearchOptions),
	tools: Schema.optional(
		Schema.Array(
			Schema.Struct({
				type: Schema.Literal("web_search"),
				web_search: Schema.Struct({
					enable: Schema.Literal(true),
					search_result: Schema.Literal(true),
					search_query: Schema.String,
				}),
			}),
		),
	),
	enable_thinking: Schema.optional(Schema.Boolean),
	enable_search: Schema.optional(Schema.Boolean),
	reasoning_effort: Schema.optional(
		Schema.Literal("none", "low", "medium", "high"),
	),
	web_search_options: Schema.optional(
		Schema.Struct({ search_context_size: Schema.Literal("medium") }),
	),
	thinking: Schema.optional(
		Schema.Struct({ type: Schema.Literal("enabled", "disabled") }),
	),
});
export type ProviderOptions = typeof ProviderOptions.Type;

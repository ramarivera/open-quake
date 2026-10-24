import { Either, Schema } from "effect";
import { AiConfigInvalid } from "./ai-errors.js";
import { GenerationControls } from "./ai-workflow-contracts.js";
import recoveredCopilot from "./copilot-presets.json";
import recoveredPresets from "./role-presets.json";

export const AiLocale = Schema.Literal(
	"en",
	"zh",
	"ja",
	"ko",
	"de",
	"fr",
	"es",
	"it",
);
export type AiLocale = typeof AiLocale.Type;
const RolePreset = Schema.Struct({
	id: Schema.Int.pipe(Schema.nonNegative()),
	key: Schema.NonEmptyString,
	prompt: Schema.String,
	names: Schema.Struct({
		en: Schema.NonEmptyString,
		zh: Schema.NonEmptyString,
		ja: Schema.NonEmptyString,
		ko: Schema.NonEmptyString,
		de: Schema.NonEmptyString,
		fr: Schema.NonEmptyString,
		es: Schema.NonEmptyString,
		it: Schema.NonEmptyString,
	}),
});
/** Data extracted without executing recovered JavaScript. Decision 12 excludes IDs 65,122,124,125. */
export const ROLE_PRESETS = Object.freeze(
	Schema.decodeUnknownSync(Schema.Array(RolePreset))(recoveredPresets).map(
		(preset) =>
			Object.freeze({ ...preset, names: Object.freeze(preset.names) }),
	),
);
export const COPILOT_PRESETS = Object.freeze(
	Schema.decodeUnknownSync(
		Schema.Array(
			Schema.Struct({
				key: Schema.String,
				roleId: Schema.Int,
				controls: GenerationControls,
				names: RolePreset.fields.names,
			}),
		),
	)(recoveredCopilot).map((preset) =>
		Object.freeze({
			...preset,
			controls: Object.freeze(preset.controls),
			names: Object.freeze(preset.names),
		}),
	),
);
export function selectRole(
	id: number,
	locale: AiLocale,
	controls: typeof GenerationControls.Type = {},
): Either.Either<
	{
		readonly name: string;
		readonly systemPrompt: string;
		readonly controls: typeof GenerationControls.Type;
	},
	AiConfigInvalid
> {
	const preset = ROLE_PRESETS.find((p) => p.id === id);
	const decoded = Schema.decodeUnknownEither(GenerationControls, {
		onExcessProperty: "error",
	})(controls);
	return preset && Either.isRight(decoded)
		? Either.right({
				name: preset.names[locale],
				systemPrompt: preset.prompt,
				controls: decoded.right,
			})
		: Either.left(new AiConfigInvalid());
}

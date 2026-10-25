import { Schema } from "effect";
import { AppLocale } from "./settings-contracts.js";
export const WizardStep = Schema.Literal(
	"welcome",
	"locale-region",
	"display",
	"profiles",
	"runtime",
	"complete",
);
export const WizardDisplay = Schema.Union(
	Schema.TaggedStruct("desktop-preview", {}),
	Schema.TaggedStruct("quake", {
		deviceId: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256)),
	}),
);
export type WizardDisplay = typeof WizardDisplay.Type;
export const Region = Schema.String.pipe(Schema.pattern(/^[A-Z]{2}$/));
const ProfileIds = Schema.Array(
	Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(256)),
).pipe(Schema.maxItems(128));
export const WizardProgress = Schema.Struct(
	{
		version: Schema.Literal(1),
		step: WizardStep,
		localeConfirmed: Schema.Boolean,
		region: Schema.optional(Region),
		display: Schema.optional(WizardDisplay),
		profileIds: ProfileIds,
		runtime: Schema.Literal("unselected", "skipped", "configured"),
		completed: Schema.Boolean,
		/** Advisory owner IDs, never selected providers or credentials. */
		suggestions: Schema.optional(
			Schema.Struct({
				provider: Schema.optional(
					Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(128)),
				),
				speech: Schema.optional(
					Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(128)),
				),
			}),
		),
	},
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);
export type WizardProgress = typeof WizardProgress.Type;
export const WizardDraft = Schema.Struct({
	step: WizardStep.pipe(Schema.filter((step) => step !== "complete")),
	locale: Schema.optional(AppLocale),
	region: Schema.optional(Region),
	display: Schema.optional(WizardDisplay),
	profileIds: Schema.optional(ProfileIds),
	runtime: Schema.optional(Schema.Literal("skipped", "configured")),
});
export type WizardDraft = typeof WizardDraft.Type;
export const WizardSnapshot = Schema.Struct({
	version: Schema.Literal(1),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	locale: AppLocale,
	step: WizardStep,
	localeConfirmed: Schema.Boolean,
	region: WizardProgress.fields.region,
	display: WizardProgress.fields.display,
	profileIds: ProfileIds,
	runtime: WizardProgress.fields.runtime,
	completed: Schema.Boolean,
	suggestions: WizardProgress.fields.suggestions,
	/** Preview remains explicitly unverified even after local completion. */
	hardwareVerified: Schema.Literal(false),
});
export type WizardSnapshot = typeof WizardSnapshot.Type;
export const INITIAL_WIZARD: WizardProgress = {
	version: 1,
	step: "welcome",
	localeConfirmed: false,
	profileIds: [],
	runtime: "unselected",
	completed: false,
};

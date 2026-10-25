import { Schema } from "effect";
export const AppLocale = Schema.Literal("en", "de");
export type AppLocale = typeof AppLocale.Type;
export const LocaleSnapshot = Schema.Struct({
	locale: AppLocale,
	revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type LocaleSnapshot = typeof LocaleSnapshot.Type;
/** Future general settings fields survive locale-only writes. */
export const SettingsDocument = Schema.Struct(
	{
		version: Schema.Literal(1),
		locale: AppLocale,
		revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
	},
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);
export type SettingsDocument = typeof SettingsDocument.Type;

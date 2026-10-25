import { Schema } from "effect";

const Coordinate = Schema.Int.pipe(Schema.between(-1000000, 1000000));
const Size = Schema.Int.pipe(Schema.between(1, 32768));
export const WindowRectangle = Schema.Struct({
	x: Coordinate,
	y: Coordinate,
	width: Size,
	height: Size,
});
export type WindowRectangle = typeof WindowRectangle.Type;
/** Extension fields are retained on disk but never projected into public views. */
export const GeneralPreferences = Schema.Struct(
	{
		version: Schema.Literal(1),
		launchAtLogin: Schema.Boolean,
		startHidden: Schema.Boolean,
		window: Schema.optional(WindowRectangle),
	},
	Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);
export type GeneralPreferences = typeof GeneralPreferences.Type;
export const GeneralPatch = Schema.Struct({
	launchAtLogin: Schema.optional(Schema.Boolean),
	startHidden: Schema.optional(Schema.Boolean),
	window: Schema.optional(WindowRectangle),
});
export type GeneralPatch = typeof GeneralPatch.Type;
export const GeneralSnapshot = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	launchAtLogin: Schema.Boolean,
	startHidden: Schema.Boolean,
	window: Schema.optional(WindowRectangle),
});
export type GeneralSnapshot = typeof GeneralSnapshot.Type;
export const StartupPlan = Schema.Struct({
	hidden: Schema.Boolean,
	window: Schema.optional(WindowRectangle),
});
export type StartupPlan = typeof StartupPlan.Type;
export const DEFAULT_GENERAL: GeneralPreferences = {
	version: 1,
	launchAtLogin: false,
	startHidden: false,
};

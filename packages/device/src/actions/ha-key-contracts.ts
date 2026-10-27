import { Schema } from "effect";

export type Json =
	| string
	| number
	| boolean
	| null
	| readonly Json[]
	| { readonly [key: string]: Json };
export const Json: Schema.Schema<Json> = Schema.suspend(() =>
	Schema.Union(
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.Null,
		Schema.Array(Json),
		Schema.Record({ key: Schema.String, value: Json }),
	),
);

/** Canonical portable HA action shape shared by assignment and execution. */
export const HaKey = Schema.Struct({
	entity_id: Schema.String,
	service: Schema.String,
	service_data: Schema.Record({ key: Schema.String, value: Json }),
	custom_display_type: Schema.Literal("icon", "default", "custom"),
	custom_display_settings: Schema.Struct({
		fontSize: Schema.Number.pipe(Schema.int(), Schema.between(10, 70)),
	}),
	custom_display_detail: Schema.Array(
		Schema.Struct({
			displayItemKey: Schema.String,
			displayAlias: Schema.String,
		}),
	),
});
export type HaKey = typeof HaKey.Type;

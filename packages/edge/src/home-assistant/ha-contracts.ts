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
export const Entity = Schema.Struct({
	entity_id: Schema.String,
	state: Schema.String,
	attributes: Schema.Record({ key: Schema.String, value: Json }),
	area: Schema.optionalWith(Schema.String, { default: () => "Other" }),
});
export type Entity = typeof Entity.Type;
export const ServiceField = Schema.Struct({
	name: Schema.String,
	label: Schema.String,
	required: Schema.Boolean,
	type: Schema.Literal("number", "boolean", "select", "text"),
	min: Schema.Number,
	max: Schema.Number,
	options: Schema.Array(Schema.String),
});
export type ServiceField = typeof ServiceField.Type;
export const HaService = Schema.Struct({
	domain: Schema.String,
	service: Schema.String,
	name: Schema.String,
	fields: Schema.Array(ServiceField),
});
export type HaService = typeof HaService.Type;
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
export const HaTarget = Schema.Struct({
	profileId: Schema.String,
	pageId: Schema.String,
	keyCode: Schema.String,
});
export type HaTarget = typeof HaTarget.Type;
export const Certificate = Schema.Struct({
	origin: Schema.String,
	fingerprint: Schema.String,
});
export type Certificate = typeof Certificate.Type;
export const HaStore = Schema.Struct({
	version: Schema.Literal(1),
	origin: Schema.String,
	credentialRef: Schema.String,
	tokenMask: Schema.String,
	trusted: Schema.Array(Certificate),
	allowlist: Schema.Union(Schema.Null, Schema.Array(Schema.String)),
});
export type HaStore = typeof HaStore.Type;
export const HaSnapshot = Schema.Struct({
	origin: Schema.String,
	tokenMask: Schema.String,
	state: Schema.Literal("Disconnected", "Connecting", "Connected", "Failed"),
	reason: Schema.String,
	certificate: Schema.Union(Schema.Null, Certificate),
	trusted: Schema.Array(Certificate),
	entities: Schema.Array(Entity),
	services: Schema.Array(HaService),
	allowlist: Schema.Array(Schema.String),
});
export type HaSnapshot = typeof HaSnapshot.Type;
export const HaLive = Schema.Struct({
	connected: Schema.Boolean,
	states: Schema.Array(Entity),
});
export type HaLive = typeof HaLive.Type;
export interface HaConnection {
	readonly entities: () => Promise<readonly Entity[]>;
	readonly services: () => Promise<readonly HaService[]>;
	readonly states: (ids: readonly string[]) => Promise<readonly Entity[]>;
	readonly execute: (
		domain: string,
		service: string,
		data: Readonly<Record<string, Json>>,
	) => Promise<void>;
	readonly close: () => void;
}
export const EMPTY_HA_STORE: HaStore = {
	version: 1,
	origin: "",
	credentialRef: "",
	tokenMask: "",
	trusted: [],
	allowlist: null,
};

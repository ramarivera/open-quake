import { Schema } from "effect";
import { Json } from "../../../device/src/actions/ha-key-contracts.js";

export { HaKey, Json } from "../../../device/src/actions/ha-key-contracts.js";
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

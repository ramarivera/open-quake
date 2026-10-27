import { Schema } from "effect";

export const LightingTarget = Schema.Struct({
	serial: Schema.NonEmptyTrimmedString,
	session: Schema.NonEmptyTrimmedString,
});
export type LightingTarget = typeof LightingTarget.Type;

export const LightingIdentity = Schema.Struct({
	firmware: Schema.NonEmptyTrimmedString,
	protocolVersion: Schema.Int.pipe(Schema.between(0, 65535)),
});
export type LightingIdentity = typeof LightingIdentity.Type;

export const LightingEvidence = Schema.Struct({
	identity: LightingIdentity,
	basis: Schema.Literal("source-qualified", "hardware-qualified", "hid-fake"),
});
const Byte = Schema.Int.pipe(Schema.between(0, 255));
const ByteRange = Schema.Struct({ min: Byte, max: Byte }).pipe(
	Schema.filter(({ min, max }) => min <= max),
);
const fieldAccess = {
	readable: Schema.Boolean,
	writable: Schema.Boolean,
	evidence: LightingEvidence,
};
export const LightingFieldCapability = Schema.Union(
	Schema.Struct({
		...fieldAccess,
		field: Schema.Literal("brightness"),
		valueId: Schema.Literal(0x09, 0x80),
		range: ByteRange,
	}),
	Schema.Struct({
		...fieldAccess,
		field: Schema.Literal("effectSpeed"),
		valueId: Schema.Literal(0x0b, 0x82, 0x03),
		range: ByteRange,
	}),
	Schema.Struct({
		...fieldAccess,
		field: Schema.Literal("effect"),
		valueId: Schema.Literal(0x0a, 0x81),
		effectIds: Schema.Array(Byte).pipe(Schema.minItems(1)),
	}),
	Schema.Struct({
		...fieldAccess,
		field: Schema.Literal("color1"),
		valueId: Schema.Literal(0x0c, 0x83),
		hue: ByteRange,
		saturation: ByteRange,
	}),
	Schema.Struct({
		...fieldAccess,
		field: Schema.Literal("color2"),
		valueId: Schema.Literal(0x0d),
		hue: ByteRange,
		saturation: ByteRange,
	}),
);
export type LightingFieldCapability = typeof LightingFieldCapability.Type;
export const LightingField = Schema.Literal(
	"brightness",
	"effect",
	"effectSpeed",
	"color1",
	"color2",
);
export type LightingField = typeof LightingField.Type;
const Color = Schema.Struct({ hue: Byte, saturation: Byte });
export const LightingChange = Schema.Union(
	Schema.Struct({
		field: Schema.Literal("brightness", "effect", "effectSpeed"),
		value: Byte,
	}),
	Schema.Struct({ field: Schema.Literal("color1", "color2"), value: Color }),
);
export type LightingChange = typeof LightingChange.Type;

export const LightingCapabilities = Schema.Struct({
	target: LightingTarget,
	identity: LightingIdentity,
	transport: Schema.Literal("legacy", "v3", "unavailable"),
	fields: Schema.Array(LightingFieldCapability),
	save: Schema.OptionFromSelf(
		Schema.Struct({
			evidence: LightingEvidence,
			completion: Schema.Literal("ack-and-readback"),
		}),
	),
});
export type LightingCapabilities = typeof LightingCapabilities.Type;

export const LightingState = Schema.Struct({
	capabilities: LightingCapabilities,
	status: Schema.Literal("reading", "ready", "unavailable"),
	desired: Schema.Array(LightingChange),
	applied: Schema.Array(LightingChange),
	saved: Schema.OptionFromSelf(Schema.Array(LightingChange)),
	saveStatus: Schema.Literal("unknown", "unsaved", "saved", "failed"),
});
export type LightingState = typeof LightingState.Type;

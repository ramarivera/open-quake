import { Schema } from "effect";

export const KEY_ALERT = {
	STOP: 0,
	INVALID: 1,
	ALARM: 2,
	CHECKMARK: 3,
} as const;
const target = {
	deviceId: Schema.NonEmptyString,
	profileId: Schema.NonEmptyString,
	pageId: Schema.NonEmptyString,
	revision: Schema.Int.pipe(Schema.nonNegative()),
	keyCode: Schema.NonEmptyString,
};
export const KeyDisplayEvent = Schema.Union(
	Schema.Struct({
		...target,
		type: Schema.Literal("showAnimation"),
		resourceId: Schema.String.pipe(
			Schema.minLength(1),
			Schema.maxLength(8 * 1024 * 1024),
		),
	}),
	Schema.Struct({
		...target,
		type: Schema.Literal("showAlert"),
		alertType: Schema.Literal(0, 1, 2, 3),
	}),
	Schema.Struct({
		...target,
		type: Schema.Literal("countdown"),
		time: Schema.Finite.pipe(Schema.greaterThanOrEqualTo(-1)),
	}),
	Schema.Struct({
		...target,
		type: Schema.Literal("progress"),
		percent: Schema.Finite.pipe(Schema.between(-1, 100)),
	}),
);
export type KeyDisplayEvent = typeof KeyDisplayEvent.Type;
export const formatCountdown = (millis: number): string => {
	const seconds = Math.max(0, Math.ceil(millis / 1000));
	return [
		Math.floor(seconds / 3600),
		Math.floor(seconds / 60) % 60,
		seconds % 60,
	]
		.map((n) => String(n).padStart(2, "0"))
		.join(":");
};

/** Device-originated panel messages. No implicit display binding is permitted. */
export const KeyPanelMessage = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("slide"),
		direction: Schema.Literal(0, 1, 2, 3),
	}),
	Schema.Struct({
		type: Schema.Literal("functionKeyPressed"),
		functionName: Schema.Literal("managementCenter"),
		tabType: Schema.optional(
			Schema.Literal("profiles", "keys", "agents", "settings"),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("globalAlert"),
		alertType: Schema.Literal("multi-screen"),
		serials: Schema.Array(Schema.NonEmptyString).pipe(Schema.maxItems(64)),
	}),
	KeyDisplayEvent,
);
export type KeyPanelMessage = typeof KeyPanelMessage.Type;

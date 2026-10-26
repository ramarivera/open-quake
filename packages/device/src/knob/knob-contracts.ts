import { Schema } from "effect";
import { AssistantSettings } from "../profiles/assistant-contracts.js";

/** JSON is confined to imported payloads and registry-validated action values. */
export type KnobJson =
	| string
	| number
	| boolean
	| null
	| ReadonlyArray<KnobJson>
	| { readonly [key: string]: KnobJson };
/** Validate without rebuilding records: Schema.Record drops an own __proto__ key. */
export const KnobJson: Schema.Schema<KnobJson> = Schema.declare(
	(input: unknown): input is KnobJson => {
		const ancestors = new Set<object>();
		const visit = (value: unknown): boolean => {
			if (
				value === null ||
				typeof value === "string" ||
				typeof value === "boolean"
			)
				return true;
			if (typeof value === "number") return Number.isFinite(value);
			if (typeof value !== "object" || ancestors.has(value)) return false;
			const prototype: unknown = Object.getPrototypeOf(value);
			if (
				!Array.isArray(value) &&
				prototype !== Object.prototype &&
				prototype !== null
			)
				return false;
			ancestors.add(value);
			const valid = Array.isArray(value)
				? value.every(visit)
				: Object.values(value).every(visit);
			ancestors.delete(value);
			return valid;
		};
		try {
			return visit(input);
		} catch {
			return false;
		}
	},
	{ identifier: "KnobJson" },
);
const nonblank = Schema.String.pipe(Schema.filter((s) => s.trim().length > 0));
const natural = Schema.Number.pipe(
	Schema.int(),
	Schema.nonNegative(),
	Schema.filter(Number.isSafeInteger),
);
const positive = Schema.Number.pipe(
	Schema.int(),
	Schema.positive(),
	Schema.filter(Number.isSafeInteger),
);

/** Matches profiles-key-grid's title contract without importing the parallel lane. */
export const KnobTitle = Schema.Struct({
	text: Schema.String,
	pos: Schema.Literal("top", "bot"),
	size: Schema.Number.pipe(Schema.finite(), Schema.positive()),
	color: Schema.String.pipe(Schema.pattern(/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/)),
	display: Schema.Boolean,
	style: Schema.String.pipe(
		Schema.filter((s) => {
			const tokens = s === "" ? [] : s.split("|");
			return (
				new Set(tokens).size === tokens.length &&
				tokens.every((t) => ["bold", "italic", "underline"].includes(t))
			);
		}),
	),
	resourceId: Schema.optionalWith(Schema.Union(natural, nonblank), {
		exact: true,
	}),
});
export type KnobTitle = typeof KnobTitle.Type;
export const DEFAULT_KNOB_TITLE: KnobTitle = {
	text: "",
	pos: "bot",
	size: 8,
	color: "#FFFFFF",
	display: true,
	style: "bold|italic|underline",
	resourceId: 0,
};
export const KnobSlotName = Schema.Literal("center", "left", "right");
export type KnobSlotName = typeof KnobSlotName.Type;
export const KNOB_SLOT_INDEX = { center: 0, left: 1, right: 2 } as const;
export const KnobAction = Schema.Struct({ type: nonblank, value: KnobJson });
export type KnobAction = typeof KnobAction.Type;
export const KnobFunction = Schema.Struct({
	childrenName: nonblank,
	config: Schema.Struct({
		type: nonblank,
		assistantSettings: Schema.optionalWith(AssistantSettings, { exact: true }),
		animations: Schema.optionalWith(
			Schema.Array(Schema.String).pipe(Schema.maxItems(4)),
			{ exact: true },
		),
		actions: Schema.Array(KnobAction),
		title: Schema.optionalWith(KnobTitle, { exact: true }),
		icon: Schema.optionalWith(Schema.String, { exact: true }),
	}),
});
export type KnobFunction = typeof KnobFunction.Type;
export const EmptyKnobSlot = Schema.Struct({
	childrenName: Schema.Literal(""),
	config: Schema.Struct({ type: Schema.Literal(""), actions: Schema.Tuple() }),
});
export const KnobSlot = Schema.Union(EmptyKnobSlot, KnobFunction);
export type KnobSlot = typeof KnobSlot.Type;
export const KnobSlots = Schema.Tuple(KnobSlot, KnobSlot, KnobSlot);
export type KnobSlots = typeof KnobSlots.Type;
export const KnobResource = Schema.Struct({
	keyCode: Schema.Literal("0,1"),
	config: Schema.Struct({
		type: Schema.Literal("knob"),
		title: KnobTitle,
		icon: Schema.String,
		size: Schema.Tuple(Schema.Literal(1), Schema.Literal(1)),
		display: Schema.Boolean,
		subActions: KnobSlots,
	}),
});
export type KnobResource = typeof KnobResource.Type;
export const KnobVoiceRoute = Schema.Literal(
	"direct",
	"dkclaw",
	"legacyAssistant",
);
export type KnobVoiceRoute = typeof KnobVoiceRoute.Type;
const stringAction = <const T extends string>(type: T) =>
	Schema.Struct({ type: Schema.Literal(type), value: Schema.String });
export const KnobVoiceActions = Schema.Array(
	Schema.Union(
		Schema.Struct({
			type: Schema.Literal("voiceRoute"),
			value: KnobVoiceRoute,
		}),
		stringAction("directProvider"),
		stringAction("directModel"),
		stringAction("agentId"),
		stringAction("dkclawModel"),
		stringAction("assistant"),
	),
).pipe(
	Schema.filter((actions) => {
		const types = actions.map((a) => a.type);
		if (new Set(types).size !== types.length) return false;
		const route = actions.find((a) => a.type === "voiceRoute")?.value;
		const fields =
			route === "direct"
				? ["voiceRoute", "directProvider", "directModel"]
				: route === "dkclaw"
					? ["voiceRoute", "agentId", "dkclawModel"]
					: route === "legacyAssistant"
						? ["voiceRoute", "assistant"]
						: [];
		return (
			fields.length > 0 &&
			types.every((t) => fields.includes(t)) &&
			fields
				.filter((f) => f !== "dkclawModel")
				.every((f) => types.some((t) => t === f))
		);
	}),
);
export type KnobVoiceActions = typeof KnobVoiceActions.Type;
export const PanelBrightnessActions = Schema.Tuple(
	Schema.Struct({
		type: Schema.Literal("stepPercent"),
		value: positive.pipe(Schema.lessThanOrEqualTo(100)),
	}),
);
export const KnobNavigationActions = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("previousPage", "nextPage"),
		actions: Schema.Tuple(),
	}),
	Schema.Struct({
		type: Schema.Literal("goToPage"),
		actions: Schema.Tuple(
			Schema.Struct({ type: Schema.Literal("page"), value: positive }),
		),
	}),
);

/** sessionId changes on reconnect AND profile selection; revision pins committed data. */
export const KnobSession = Schema.Struct({
	deviceId: nonblank,
	sessionId: nonblank,
	profileId: nonblank,
	revision: natural,
});
export type KnobSession = typeof KnobSession.Type;
const sessionFields = { session: KnobSession };
const pressFields = { ...sessionFields, pressId: nonblank };
export const KnobEvent = Schema.Union(
	Schema.TaggedStruct("Rotate", {
		...sessionFields,
		direction: Schema.Literal("counterclockwise", "clockwise"),
		detents: positive,
	}),
	Schema.TaggedStruct("Press", pressFields),
	Schema.TaggedStruct("HoldStart", pressFields),
	Schema.TaggedStruct("Release", {
		...pressFields,
		classification: Schema.Literal("short", "held", "cancelled"),
	}),
	Schema.TaggedStruct("Disconnect", sessionFields),
);
export type KnobEvent = typeof KnobEvent.Type;
export const KnobFocusedControl = Schema.Struct({
	keyCode: nonblank,
	visible: Schema.Boolean,
	supportKnob: Schema.Boolean,
	/** The action lane supplies two individually validated directional assignments. */
	directions: Schema.Tuple(KnobFunction, KnobFunction),
});
export const KnobSnapshot = Schema.Struct({
	session: KnobSession,
	knob: Schema.optionalWith(KnobResource, { as: "Option" }),
	focused: Schema.optionalWith(KnobFocusedControl, { as: "Option" }),
});
export type KnobSnapshot = typeof KnobSnapshot.Type;
export const KnobDispatchCommand = Schema.Struct({
	session: KnobSession,
	route: Schema.Literal("focused", "left", "right", "center"),
	assignment: KnobFunction,
	activation: Schema.Literal("rotate", "press"),
	direction: Schema.optionalWith(
		Schema.Literal("counterclockwise", "clockwise"),
		{ exact: true },
	),
});
export type KnobDispatchCommand = typeof KnobDispatchCommand.Type;

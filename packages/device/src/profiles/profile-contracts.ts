import { Effect, Option, ParseResult, Predicate, Schema } from "effect";
import { AssistantSettings } from "./assistant-contracts.js";
import { QUAKE_LOGICAL_GRID } from "./profile-grid.js";
import {
	isEmptyCell,
	layoutIssues,
	parseProfileCoordinate,
} from "./profile-invariants.js";
import { ProfileManagerState } from "./profile-manager-contracts.js";

export { QUAKE_LOGICAL_GRID } from "./profile-grid.js";

export type ProfileJson =
	| string
	| number
	| boolean
	| null
	| readonly ProfileJson[]
	| { readonly [key: string]: ProfileJson };
export const ProfileJson: Schema.Schema<ProfileJson> = Schema.suspend(() =>
	Schema.Union(
		Schema.String,
		Schema.Finite,
		Schema.Boolean,
		Schema.Null,
		Schema.Array(ProfileJson),
		ProfileJsonObject,
	),
);
const isJsonRecord = (input: unknown): input is Record<string, unknown> => {
	if (!Predicate.isRecord(input)) return false;
	const proto = Object.getPrototypeOf(input);
	return proto === Object.prototype || proto === null;
};
const parseJsonObject: ParseResult.DeclarationDecodeUnknown<
	{ readonly [key: string]: ProfileJson },
	never
> = (input, options, ast) => {
	// Only plain or null-prototype records are JSON. Date/Map/Set/class instances
	// would enumerate no entries and silently decode to {}.
	if (!isJsonRecord(input))
		return ParseResult.fail(new ParseResult.Type(ast, input));
	return Effect.forEach(Object.entries(input), ([key, value]) =>
		ParseResult.decodeUnknown(ProfileJson)(value, options).pipe(
			ParseResult.mapError(
				(issue) => new ParseResult.Pointer(key, input, issue),
			),
			ParseResult.map((decoded) => [key, decoded] as const),
		),
	).pipe(
		Effect.map((entries) => {
			// fromEntries defines own properties without invoking __proto__ setters.
			// A null prototype keeps compatibility payloads inert on later reads too.
			const record = Object.fromEntries(entries);
			Object.setPrototypeOf(record, null);
			return record;
		}),
	);
};
export const ProfileJsonObject = Schema.declare(
	[],
	{ decode: () => parseJsonObject, encode: () => parseJsonObject },
	{ identifier: "ProfileJsonObject" },
);
const optional = <A, I>(schema: Schema.Schema<A, I>) =>
	Schema.optionalWith(schema, { as: "Option", exact: true });
const StableId = Schema.String.pipe(Schema.minLength(1));
export const ProfileRevision = Schema.Number.pipe(
	Schema.int(),
	Schema.nonNegative(),
	Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const ProfileCoordinate = Schema.String.pipe(
	Schema.filter((code) => Option.isSome(parseProfileCoordinate(code))),
);
export const ProfileTitle = Schema.Struct({
	userModifiedStyle: Schema.optional(Schema.Boolean),
	multiLanguage: Schema.optional(Schema.Boolean),
	i18nKey: Schema.optional(Schema.String),
	text: Schema.String,
	pos: Schema.Literal("top", "mid", "bot"),
	size: Schema.Finite.pipe(Schema.positive()),
	color: Schema.String.pipe(Schema.pattern(/^#[\da-fA-F]{6}([\da-fA-F]{2})?$/)),
	display: Schema.Boolean,
	style: Schema.String.pipe(
		Schema.filter((style) => {
			if (style === "") return true;
			const tokens = style.split("|");
			return (
				tokens.every((token) =>
					["bold", "italic", "underline"].includes(token),
				) && new Set(tokens).size === tokens.length
			);
		}),
	),
	resourceId: optional(Schema.Union(ProfileRevision, StableId)),
});
export type ProfileTitle = typeof ProfileTitle.Type;
export const ProfileEditPolicy = Schema.Struct({
	title: Schema.optionalWith(Schema.Boolean, { default: () => true }),
	grid: Schema.optionalWith(Schema.Boolean, { default: () => true }),
	icon: Schema.optionalWith(Schema.Boolean, { default: () => true }),
	allowDelete: Schema.optionalWith(Schema.Boolean, { default: () => true }),
	allowDrag: Schema.optionalWith(Schema.Boolean, { default: () => true }),
});
export type ProfileEditPolicy = typeof ProfileEditPolicy.Type;
export const ProfileAction = Schema.Struct({
	type: StableId,
	value: ProfileJson,
});
const KeyConfigFields = Schema.Struct({
	assistantSettings: Schema.optional(AssistantSettings),
	temperatureUnit: Schema.optionalWith(
		Schema.Literal("celsius", "fahrenheit"),
		{ exact: true },
	),
	aiConfigData: Schema.optional(ProfileJsonObject),
	sessionState: Schema.optional(Schema.Literal("start", "end", "error")),
	animationState: Schema.optional(
		Schema.Literal("recording", "processing", "idle"),
	),
	assistantType: Schema.optional(Schema.Literal("chat", "keyConfig")),
	userModifiedTitle: Schema.optional(Schema.Boolean),
	userModifiedAlterTitle: Schema.optional(Schema.Boolean),
	type: Schema.String,
	title: ProfileTitle,
	size: Schema.Tuple(
		Schema.Number.pipe(
			Schema.int(),
			Schema.between(1, QUAKE_LOGICAL_GRID.columns),
		),
		Schema.Number.pipe(
			Schema.int(),
			Schema.between(1, QUAKE_LOGICAL_GRID.rows),
		),
	),
	display: Schema.Boolean,
	supportKnob: Schema.optionalWith(Schema.Boolean, { default: () => false }),
	supportTouchEffect: Schema.optionalWith(Schema.Boolean, {
		default: () => false,
	}),
	icon: Schema.String,
	alterTitle: optional(ProfileTitle),
	alterIcon: optional(Schema.String),
	subActions: optional(Schema.Array(ProfileJsonObject)),
	basicEditableItems: optional(ProfileEditPolicy),
	compatibility: optional(ProfileJsonObject),
});
export const ProfileKeyConfig = Schema.Union(
	Schema.Struct({
		...KeyConfigFields.fields,
		actions: Schema.Array(ProfileAction),
	}),
	Schema.Struct({
		...KeyConfigFields.fields,
		actions: Schema.optionalWith(
			Schema.Array(ProfileAction).pipe(
				Schema.filter((actions) => actions.length === 0),
			),
			{ default: () => [] },
		),
	}).pipe(
		Schema.filter(
			(config) => config.type !== "" && Option.isSome(config.subActions),
		),
	),
);
const KeyRecord = Schema.Struct({
	keyCode: ProfileCoordinate,
	childrenName: optional(StableId),
	config: ProfileKeyConfig,
	compatibility: optional(ProfileJsonObject),
});
export type ProfileKey = typeof KeyRecord.Type;
export const ProfileKey = KeyRecord.pipe(
	Schema.filter((key) =>
		key.config.type === ""
			? isEmptyCell(key)
			: Option.isSome(key.childrenName) ||
				(Option.isSome(key.compatibility) &&
					key.compatibility.value.unsupported === true),
	),
	Schema.filter((key) => layoutIssues([key]).length === 0),
);
export const ProfilePage = Schema.Struct({
	id: StableId,
	keys: Schema.Array(ProfileKey).pipe(
		Schema.filter((keys) => layoutIssues(keys).length === 0),
	),
	compatibility: optional(ProfileJsonObject),
});
export type ProfilePage = typeof ProfilePage.Type;
/** Retained without runtime interpretation; the knob domain owns its config. */
export const ProfileKnob = Schema.Struct({
	keyCode: Schema.Literal(QUAKE_LOGICAL_GRID.knobCode),
	config: ProfileJsonObject,
});
export const Profile = Schema.Struct({
	id: StableId,
	name: Schema.String.pipe(Schema.filter((name) => name.trim().length > 0)),
	revision: ProfileRevision,
	pages: Schema.NonEmptyArray(ProfilePage).pipe(
		Schema.filter(
			(pages) => new Set(pages.map((page) => page.id)).size === pages.length,
		),
	),
	knob: optional(ProfileKnob),
	compatibility: optional(ProfileJsonObject),
});
export type Profile = typeof Profile.Type;
export const ProfileDraft = Profile.pipe(Schema.omit("revision"));
export const SaveProfileRequest = Schema.Struct({
	expectedRevision: ProfileRevision,
	profile: ProfileDraft,
});
export type SaveProfileRequest = typeof SaveProfileRequest.Encoded;
export const SelectProfileRequest = Schema.Struct({
	deviceId: StableId.pipe(Schema.filter((serial) => serial !== "__proto__")),
	profileId: StableId,
	pageId: Schema.optional(StableId),
});
export const ProfileSelection = Schema.Struct({
	profileId: StableId,
	pageId: StableId,
});
export type ProfileSelection = typeof ProfileSelection.Type;
/** Reference repair is explicit in the repository, not a lossy Schema transform. */
export const ProfileEnvelope = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	/** Atomic completion marker for desktop legacy clock configuration migration. */
	clockConfigVersion: Schema.optionalWith(Schema.Literal(1), { exact: true }),
	manager: optional(ProfileManagerState),
	profiles: Schema.NonEmptyArray(Profile).pipe(
		Schema.filter(
			(profiles) =>
				new Set(profiles.map((profile) => profile.id)).size === profiles.length,
		),
	),
	// Effect's Record decoder assigns into a plain object. Reject its prototype
	// setter even when callers decode without excess-property checking.
	activeByDevice: Schema.Record({
		key: StableId.pipe(Schema.filter((serial) => serial !== "__proto__")),
		value: ProfileSelection,
	}).annotations({ parseOptions: { onExcessProperty: "error" } }),
});
export type ProfileEnvelope = typeof ProfileEnvelope.Type;
export type EncodedProfileEnvelope = typeof ProfileEnvelope.Encoded;
export const encodeProfileEnvelope = Schema.encodeSync(ProfileEnvelope);

export const EMPTY_PROFILE_TITLE = {
	text: "",
	pos: "bot",
	size: 8,
	color: "#FFFFFF",
	display: true,
	style: "bold|italic|underline",
	resourceId: 0,
} as const;

export const createEmptyProfileKey = (keyCode: string): ProfileKey =>
	Schema.decodeUnknownSync(ProfileKey)({
		keyCode,
		config: {
			type: "",
			title: EMPTY_PROFILE_TITLE,
			size: [1, 1],
			display: true,
			icon: "",
			actions: [],
		},
	});

export const createInitialProfileEnvelope = (): ProfileEnvelope =>
	Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "local-profile",
				name: "My profile",
				revision: 0,
				pages: [{ id: "local-page", keys: [] }],
			},
		],
		activeByDevice: {},
	});

/** Profile-level routing is inherited by every page. */
export const createDefaultProfileKnob = (): typeof ProfileKnob.Type =>
	Schema.decodeUnknownSync(ProfileKnob)({
		keyCode: "0,1",
		config: {
			type: "knob",
			icon: "0-50",
			subActions: [
				{
					type: "assistant",
					animations: ["0-47", "0-48", "0-49", "0-51"],
					actions: [
						{ type: "voiceRoute", value: "legacyAssistant" },
						{ type: "assistant", value: "" },
					],
				},
			],
		},
	});

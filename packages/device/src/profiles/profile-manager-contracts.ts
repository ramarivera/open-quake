import { Schema } from "effect";

export const ProfileLocale = Schema.Literal(
	"en",
	"zh",
	"de",
	"fr",
	"it",
	"es",
	"ja",
	"ko",
);
export type ProfileLocale = typeof ProfileLocale.Type;
export const ProfilePlatform = Schema.Literal("darwin", "win32", "linux");
export type ProfilePlatform = typeof ProfilePlatform.Type;
export const AppProfileLink = Schema.Struct({
	profileId: Schema.String,
	appPath: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4096)),
	appIdentifier: Schema.String.pipe(Schema.minLength(1)),
	device: Schema.optionalWith(Schema.String, { as: "Option" }),
});
export type AppProfileLink = typeof AppProfileLink.Type;
export const ProfileManagerState = Schema.Struct({
	revision: Schema.Int.pipe(Schema.nonNegative()),
	nextId: Schema.optionalWith(Schema.Int.pipe(Schema.positive()), {
		default: () => 1,
	}),
	installed: Schema.Boolean,
	hidden: Schema.Array(Schema.String),
	startup: Schema.optionalWith(Schema.String, { as: "Option" }),
	userHasSetDefault: Schema.Boolean,
	anchor: Schema.optionalWith(Schema.String, { as: "Option" }),
	links: Schema.Array(AppProfileLink),
	approvedCommands: Schema.Array(Schema.String),
});
export type ProfileManagerState = typeof ProfileManagerState.Type;
export const ManagerCommand = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("default-visibility"),
		ids: Schema.Array(Schema.String),
	}),
	Schema.Struct({ type: Schema.Literal("create") }),
	Schema.Struct({
		type: Schema.Literal("rename"),
		id: Schema.String,
		name: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("duplicate"),
		id: Schema.String,
		locale: Schema.optional(ProfileLocale),
	}),
	Schema.Struct({
		type: Schema.Literal("select"),
		id: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("delete"),
		id: Schema.String,
		confirmed: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal("visibility"),
		id: Schema.String,
		visible: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal("startup"),
		id: Schema.String,
		enabled: Schema.Boolean,
		confirmed: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal("link"),
		id: Schema.String,
		link: Schema.NullOr(AppProfileLink),
	}),
);
export type ManagerCommand = typeof ManagerCommand.Type;

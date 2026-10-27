import { Schema } from "effect";

export const PANEL_CANVAS = { width: 1920, height: 480 } as const;
export const DESKTOP_RESOURCE_LIMIT = 8 * 1024 * 1024;
export const DisplayIdentity = Schema.Trimmed.pipe(Schema.nonEmptyString());
export const AssetReference = Schema.String.pipe(
	Schema.pattern(/^media:[a-f0-9]{64}$/),
);
export const FillMode = Schema.Literal("contain", "cover", "center");
export type FillMode = typeof FillMode.Type;
export const PositiveDimension = Schema.Int.pipe(Schema.positive());
const Duration = Schema.Finite.pipe(Schema.positive());
const MediaFields = {
	name: DisplayIdentity,
	filePath: AssetReference,
	duration: Duration,
};
export const DisplayMedia = Schema.Union(
	Schema.Struct({
		...MediaFields,
		type: Schema.Literal("image"),
		format: Schema.Literal("image/jpeg", "image/png", "image/gif"),
	}),
	Schema.Struct({
		...MediaFields,
		type: Schema.Literal("video"),
		format: Schema.Literal(
			"video/mp4",
			"video/webm",
			"video/quicktime",
			"video/x-matroska",
			"video/x-msvideo",
		),
		duration: Duration.pipe(Schema.greaterThanOrEqualTo(2000)),
	}),
);
export type DisplayMedia = typeof DisplayMedia.Type;
export const WallpaperSettings = Schema.Struct({
	isTransparent: Schema.Boolean,
	enableSound: Schema.optionalWith(Schema.Boolean, { default: () => false }),
	bgFillMode: FillMode,
	gapInterval: Schema.Int,
	gapIntervalUnit: Schema.Literal(0, 1),
	playMode: Schema.Literal("sequential", "random"),
	displayMediaList: Schema.Array(DisplayMedia),
}).pipe(
	Schema.filter((s) =>
		s.gapIntervalUnit === 0
			? s.gapInterval >= 3 && s.gapInterval <= 86400
			: s.gapInterval >= 1 && s.gapInterval <= 1440,
	),
	Schema.filter((s) =>
		s.displayMediaList.every(
			(media) =>
				media.type !== "image" ||
				media.duration ===
					s.gapInterval * (s.gapIntervalUnit === 0 ? 1000 : 60000),
		),
	),
);
export type WallpaperSettings = typeof WallpaperSettings.Type;
export const StaticWallpaperSettings = WallpaperSettings.pipe(
	Schema.filter(
		(s) =>
			!s.isTransparent &&
			s.displayMediaList.length <= 1 &&
			s.displayMediaList.every((media) => media.type === "image"),
	),
);
export const defaultWallpaper: WallpaperSettings = {
	isTransparent: false,
	enableSound: false,
	bgFillMode: "cover",
	gapInterval: 5,
	gapIntervalUnit: 0,
	playMode: "sequential",
	displayMediaList: [],
};

export const HourFormat = Schema.Literal("24h", "12h");
export type HourFormat = typeof HourFormat.Type;
export const DesktopClockTile = Schema.Struct({
	type: Schema.Literal("dkDesktopClock"),
	actions: Schema.Tuple(
		Schema.Struct({ type: Schema.Literal("hourFormat"), value: HourFormat }),
	),
});
export type DesktopClockTile = typeof DesktopClockTile.Type;
export const defaultClockTile: DesktopClockTile = {
	type: "dkDesktopClock",
	actions: [{ type: "hourFormat", value: "24h" }],
};
export const displayTileRegistry = {
	dkDesktopClock: { schema: DesktopClockTile, defaults: defaultClockTile },
} as const;
export const SavedWallpaper = Schema.Struct({
	version: Schema.Literal(1),
	serial: DisplayIdentity,
	revision: Schema.Int.pipe(Schema.nonNegative()),
	settings: WallpaperSettings.pipe(
		Schema.filter(
			(s) =>
				s.displayMediaList.length <= 128 &&
				new Set(s.displayMediaList.map((m) => m.filePath)).size ===
					s.displayMediaList.length,
		),
	),
	clock: DesktopClockTile,
});
export type SavedWallpaper = typeof SavedWallpaper.Type;
export const ClockSnapshot = Schema.Struct({
	epochMillis: Schema.Finite,
	hour: Schema.Int.pipe(Schema.between(0, 23)),
	minute: Schema.Int.pipe(Schema.between(0, 59)),
	second: Schema.Int.pipe(Schema.between(0, 59)),
});
export type ClockSnapshot = typeof ClockSnapshot.Type;

export const LogicalResourceKey = Schema.Struct({
	row: Schema.Int.pipe(Schema.between(1, 3)),
	column: Schema.Int.pipe(Schema.between(1, 5)),
});
export const ResourceTarget = Schema.Union(
	Schema.TaggedStruct("key", { key: LogicalResourceKey }),
	Schema.TaggedStruct("full-panel", { capabilityId: DisplayIdentity }),
);
export type ResourceTarget = typeof ResourceTarget.Type;
export const ResourceRequest = Schema.Struct({
	deviceId: DisplayIdentity,
	profileId: DisplayIdentity,
	pageId: DisplayIdentity,
	revision: Schema.Int.pipe(Schema.nonNegative()),
	assetId: AssetReference,
	format: Schema.Literal("jpeg"),
	target: ResourceTarget,
});
export type ResourceRequest = typeof ResourceRequest.Type;
/** Evidence belongs to an exact device/firmware, never a guessed key code. */
export const VerifiedResourceCapability = Schema.Struct({
	deviceId: DisplayIdentity,
	firmware: DisplayIdentity,
	evidence: DisplayIdentity,
	targets: Schema.Array(ResourceTarget),
});
export type VerifiedResourceCapability = typeof VerifiedResourceCapability.Type;

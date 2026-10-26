import { Schema } from "effect";
import {
	ClockSnapshot,
	DisplayIdentity,
	FillMode,
	HourFormat,
	PositiveDimension,
	SavedWallpaper,
} from "./display";

export const WALLPAPER_REQUEST = "wallpaper:request";
export const WALLPAPER_SNAPSHOT = "wallpaper:snapshot";
export const WALLPAPER_AUDIO = "wallpaper:audio";
export const WallpaperAudioCommand = Schema.Struct({
	id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
	active: Schema.Boolean,
	serial: DisplayIdentity,
	revision: Schema.Int.pipe(Schema.nonNegative()),
});
export type WallpaperAudioCommand = typeof WallpaperAudioCommand.Type;
export const WALLPAPER_CLOCK = "wallpaper:clock";
const Revision = Schema.Int.pipe(Schema.nonNegative());
const Selection = { serial: DisplayIdentity, revision: Revision };
export const WallpaperCommand = Schema.Union(
	Schema.TaggedStruct("read", {}),
	Schema.TaggedStruct("select", { serial: DisplayIdentity }),
	Schema.TaggedStruct("import", {
		...Selection,
		append: Schema.optional(Schema.Boolean),
	}),
	Schema.TaggedStruct("sound", { ...Selection, enableSound: Schema.Boolean }),
	Schema.TaggedStruct("reorder", {
		...Selection,
		from: Schema.Int.pipe(Schema.nonNegative()),
		to: Schema.Int.pipe(Schema.nonNegative()),
	}),
	Schema.TaggedStruct("remove", {
		...Selection,
		index: Schema.Int.pipe(Schema.nonNegative()),
	}),
	Schema.TaggedStruct("clear", Selection),
	Schema.TaggedStruct("restore", Selection),
	Schema.TaggedStruct("configure", {
		...Selection,
		fillMode: FillMode,
		hourFormat: HourFormat,
	}),
);
export type WallpaperCommand = typeof WallpaperCommand.Type;
export const WallpaperSnapshot = Schema.Struct({
	saved: SavedWallpaper,
	asset: Schema.Union(
		Schema.TaggedStruct("empty", {}),
		Schema.TaggedStruct("unreadable", {}),
		Schema.TaggedStruct("ready", {
			dataUrl: Schema.String.pipe(
				Schema.pattern(
					/^data:(image\/(png|jpeg)|video\/(mp4|webm|quicktime));base64,[A-Za-z0-9+/]+=*$/,
				),
			),
			width: PositiveDimension,
			height: PositiveDimension,
		}),
	),
	activeIndex: Schema.optional(Schema.Int.pipe(Schema.nonNegative())),
	recovered: Schema.Boolean,
	normalizedFileUrl: Schema.Boolean,
	deviceDelivery: Schema.Literal("unverified"),
	clock: ClockSnapshot,
});
export type WallpaperSnapshot = typeof WallpaperSnapshot.Type;
export const WallpaperReply = Schema.Union(
	Schema.TaggedStruct("success", { snapshot: WallpaperSnapshot }),
	Schema.TaggedStruct("failure", {
		code: Schema.Literal(
			"QUAKE.DISPLAY.INVALID_WALLPAPER",
			"QUAKE.DISPLAY.MEDIA_UNREADABLE",
			"QUAKE.DISPLAY.MEDIA_PERSISTENCE_FAILED",
		),
		message: Schema.String,
	}),
);
export type WallpaperReply = typeof WallpaperReply.Type;
export interface WallpaperBridge {
	request(command: WallpaperCommand): Promise<unknown>;
	audio?(command: WallpaperAudioCommand): Promise<unknown>;
	onSnapshot(callback: (snapshot: unknown) => void): () => void;
	onClock(callback: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeWallpaper?: WallpaperBridge;
	}
}

import { Effect, Schema } from "effect";
import {
	MediaSession,
	type MediaSource,
} from "../../../shared/weather-media-contracts";
import { MediaResponseInvalid } from "./errors";

const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Finite));
export const MacMedia = Schema.Struct({
	bundleIdentifier: Schema.optional(
		Schema.String.pipe(Schema.minLength(1), Schema.maxLength(300)),
	),
	processIdentifier: Schema.Int.pipe(Schema.between(1, 2147483647)),
	playing: Schema.Boolean,
	title: Schema.String.pipe(Schema.maxLength(1000)),
	artist: Schema.optional(
		Schema.NullOr(Schema.String.pipe(Schema.maxLength(1000))),
	),
	duration: OptionalNumber,
	elapsedTimeNow: OptionalNumber,
	elapsedTime: OptionalNumber,
	supportedCommands: Schema.Array(Schema.Int).pipe(Schema.maxItems(256)),
	artworkMimeType: Schema.optional(Schema.String),
	artworkData: Schema.optional(Schema.Unknown),
});
export type MacMedia = typeof MacMedia.Type;
export interface NativeMediaReading {
	readonly session: MediaSession;
	readonly sessions?: readonly (typeof MediaSource.Type)[];
	readonly lyrics?: string;
	readonly commands: ReadonlySet<number>;
	readonly source: string;
	readonly processId?: number;
}
export type NativeMediaResult = Omit<NativeMediaReading, "session"> & {
	readonly session: MediaSession | null;
};
export type CoverDecoder = (base64: string, mime: string) => string | null;
export const parseMacMedia = (
	text: string,
	cover: CoverDecoder,
): Effect.Effect<NativeMediaReading | null, MediaResponseInvalid> =>
	Effect.try({
		try: () => {
			const raw: unknown = JSON.parse(text);
			if (raw === null) return null;
			const data = Schema.decodeUnknownSync(MacMedia)(raw);
			const commands = new Set(data.supportedCommands);
			const durationMs =
				data.duration !== undefined &&
				data.duration !== null &&
				data.duration >= 0 &&
				data.duration <= Number.MAX_SAFE_INTEGER / 1000
					? data.duration * 1000
					: null;
			let positionMs = Math.max(
				0,
				Math.min(
					Number.MAX_SAFE_INTEGER / 1000,
					data.elapsedTimeNow ?? data.elapsedTime ?? 0,
				) * 1000,
			);
			if (durationMs !== null) positionMs = Math.min(durationMs, positionMs);
			const coverUrl =
				typeof data.artworkData === "string" &&
				data.artworkData.length <= 2_800_000 &&
				data.artworkMimeType
					? cover(data.artworkData, data.artworkMimeType)
					: null;
			const session: MediaSession = {
				id: `${data.bundleIdentifier ?? "pid"}:${data.processIdentifier}`,
				appName: data.bundleIdentifier?.split(".").at(-1)?.slice(0, 200) ?? "",
				appId: data.bundleIdentifier ?? "",
				title: data.title,
				artist: data.artist ?? "",
				coverUrl,
				playing: data.playing,
				durationMs,
				positionMs,
				canPlay: commands.has(0),
				canPause: commands.has(1),
				canPrevious: commands.has(5),
				canNext: commands.has(4),
			};
			return {
				session: Schema.decodeUnknownSync(MediaSession)(session),
				commands,
				source: data.bundleIdentifier ?? "",
				processId: data.processIdentifier,
			};
		},
		catch: MediaResponseInvalid.fromCause,
	});

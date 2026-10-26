import { Effect, Layer } from "effect";
import type { MediaFailure } from "../../../shared/weather-media-contracts";
import type { NativeMediaAction, NativeMediaState } from "../system-media";
import { SystemMediaAdapter, systemMediaStub } from "../system-media";
import type { SystemMediaError } from "./errors";
import { launchMediaPlayer } from "./launchers";
import { makeMacMedia } from "./macos";
import type {
	CoverDecoder,
	NativeMediaReading,
	NativeMediaResult,
} from "./metadata";
import { type MediaProcess, mediaProcess } from "./process";
import { makeWindowsMedia } from "./windows";

export function nativeSystemMedia(options: {
	platform: string;
	directory: string;
	cover: CoverDecoder;
	enabled: boolean;
	run?: MediaProcess;
}): Layer.Layer<SystemMediaAdapter> {
	if (!options.enabled || !["darwin", "win32"].includes(options.platform))
		return systemMediaStub(options.platform);
	const native: {
		read: (
			target?: string | null,
		) => Effect.Effect<NativeMediaResult | null, SystemMediaError>;
		control: (
			action: NativeMediaAction,
			reading: NativeMediaReading,
		) => Effect.Effect<boolean, SystemMediaError>;
	} =
		options.platform === "darwin"
			? makeMacMedia(options.directory, options.cover, options.run)
			: makeWindowsMedia(options.run, options.cover);
	let reading: NativeMediaReading | null = null;
	const failure = (error: {
		readonly _tag: string;
		readonly originalCause: unknown;
	}): MediaFailure => {
		if (error._tag === "MediaHelperUnavailable")
			return options.platform === "darwin"
				? "MEDIAREMOTE_UNAVAILABLE"
				: "SMTC_UNAVAILABLE";
		const cause = error.originalCause;
		if (
			options.platform === "win32" &&
			cause &&
			typeof cause === "object" &&
			"code" in cause &&
			cause.code === "ENOENT"
		)
			return "SMTC_UNAVAILABLE";
		if (
			cause &&
			typeof cause === "object" &&
			"code" in cause &&
			["EACCES", "EPERM"].includes(String(cause.code))
		)
			return "TCC_DENIED";
		return "TRANSPORT_ERROR";
	};
	return Layer.succeed(SystemMediaAdapter, {
		launch: (id) =>
			launchMediaPlayer(options.platform, options.run ?? mediaProcess, id),
		read: Effect.fn("SystemMedia.nativeRead")(function* (
			target?: string | null,
		) {
			return yield* native.read(target).pipe(
				Effect.map((value): NativeMediaState => {
					reading = value?.session
						? { ...value, session: value.session }
						: null;
					return {
						session: value?.session ?? null,
						error: null,
						sessions:
							value?.sessions ?? (value?.session ? [value.session] : []),
						lyrics: value?.lyrics
							? { _tag: "available", text: value.lyrics }
							: { _tag: "unavailable" },
					};
				}),
				Effect.catchTags({
					MediaHelperUnavailable: (error) =>
						Effect.logWarning("Native media request failed", error).pipe(
							Effect.as({ session: null, error: failure(error) }),
						),
					MediaProcessFailed: (error) =>
						Effect.logWarning("Native media request failed", error).pipe(
							Effect.as({ session: null, error: failure(error) }),
						),
					MediaResponseInvalid: (error) =>
						Effect.logWarning("Native media request failed", error).pipe(
							Effect.as({ session: null, error: failure(error) }),
						),
				}),
				Effect.tap((state) => {
					if (state.error) reading = null;
					return Effect.void;
				}),
			);
		}),
		control: Effect.fn("SystemMedia.nativeControl")(function* (action) {
			if (!reading) return false;
			return yield* native.control(action, reading).pipe(
				Effect.catchTags({
					MediaHelperUnavailable: (error) =>
						Effect.logWarning("Native media request failed", error).pipe(
							Effect.as(false),
						),
					MediaProcessFailed: (error) =>
						Effect.logWarning("Native media request failed", error).pipe(
							Effect.as(false),
						),
					MediaResponseInvalid: (error) =>
						Effect.logWarning("Native media request failed", error).pipe(
							Effect.as(false),
						),
				}),
			);
		}),
	});
}

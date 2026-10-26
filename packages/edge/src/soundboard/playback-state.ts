import type { Effect, Fiber, Option, Scope } from "effect";
import type { AudioOutputError } from "../audio/output-errors.js";
import type { AudioOutputLease } from "../audio/output-service.js";
import type {
	SoundOwner,
	SoundPlaylist,
	SoundSession,
} from "./playback-contracts.js";
import type { SoundGain } from "./playback-gain.js";
import type { SoundPlayer } from "./playback-ports.js";
import type {
	SoundboardConfigInvalid,
	SoundboardDecodeFailed,
	SoundboardFileUnavailable,
	SoundboardLoadTimeout,
} from "./soundboard-errors.js";

export type SoundPlaybackError =
	| SoundboardConfigInvalid
	| SoundboardFileUnavailable
	| SoundboardDecodeFailed
	| SoundboardLoadTimeout
	| AudioOutputError;

export interface SoundStartOptions {
	readonly additional?: boolean;
	readonly loopTrack?: boolean;
	readonly initialGain?: number | undefined;
	readonly expectedEpoch?: number;
	readonly initialIndex?: number;
	readonly initialPositionMs?: number;
	readonly accept?: () => boolean;
}
export type StartSound = (
	owner: SoundOwner,
	playlist: SoundPlaylist,
	options?: SoundStartOptions,
) => Effect.Effect<SoundSession, SoundPlaybackError>;

export interface PlaybackGroup {
	active: boolean;
	lease: Option.Option<AudioOutputLease>;
	readonly slots: Set<PlaybackSlot>;
}

/** Private live resources. Public observations go through the repository allowlist. */
export interface PlaybackSlot {
	session: SoundSession;
	readonly playlist: SoundPlaylist;
	readonly group: PlaybackGroup;
	command: number;
	scan: number;
	endPending: boolean;
	stopAfterRamp: Option.Option<number>;
	navigation: Option.Option<number>;
	replacement: Option.Option<number>;
	targetGain: number;
	gain: Option.Option<SoundGain>;
	track: Option.Option<{
		readonly scope: Scope.CloseableScope;
		readonly close: Effect.Effect<void>;
	}>;
	player: Option.Option<SoundPlayer>;
	watcher: Option.Option<Fiber.RuntimeFiber<void, never>>;
	stop: Effect.Effect<void>;
}

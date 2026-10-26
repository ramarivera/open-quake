import { Context, type Effect, type Scope } from "effect";
import type { SoundEntry } from "./soundboard-contracts.js";
import type { SoundboardDecodeFailed } from "./soundboard-errors.js";

/** Native lifetime belongs to the supplied scope, including interrupted/late acquisition. */
export interface SoundPlayer {
	readonly ready: Effect.Effect<void, SoundboardDecodeFailed>;
	readonly play: Effect.Effect<void, SoundboardDecodeFailed>;
	readonly pause: Effect.Effect<void, SoundboardDecodeFailed>;
	readonly position: Effect.Effect<number, SoundboardDecodeFailed>;
	readonly gain: (gain: number) => Effect.Effect<void, SoundboardDecodeFailed>;
	/** Completes once at natural end, never because the owner stopped the track. */
	readonly ended: Effect.Effect<void, SoundboardDecodeFailed>;
}
export class SoundboardPlayer extends Context.Tag("SoundboardPlayer")<
	SoundboardPlayer,
	{
		readonly open: (
			entry: SoundEntry,
		) => Effect.Effect<SoundPlayer, SoundboardDecodeFailed, Scope.Scope>;
	}
>() {}

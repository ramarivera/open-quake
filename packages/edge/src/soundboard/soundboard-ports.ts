import { Context, type Effect } from "effect";
import type { SoundEntry } from "./soundboard-contracts.js";
import type { SoundboardFileUnavailable } from "./soundboard-errors.js";
export type SoundFileAvailability = Exclude<
	SoundEntry["status"],
	"unchecked" | "invalidPath" | "notMp3"
>;
/** Only stat/access the explicitly listed path. No scan, decode, playback or persistence. */
export class SoundboardFiles extends Context.Tag("SoundboardFiles")<
	SoundboardFiles,
	{
		readonly inspect: (
			path: string,
		) => Effect.Effect<SoundFileAvailability, SoundboardFileUnavailable>;
	}
>() {}

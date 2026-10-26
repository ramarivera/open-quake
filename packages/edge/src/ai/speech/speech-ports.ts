import { Context, type Effect } from "effect";
import type { AiError } from "../ai-errors.js";
import type { GeneratedAudio } from "./speech-contracts.js";

export type SpeechOutputTarget =
	| { readonly kind: "assistant" }
	| {
			readonly kind: "device";
			readonly serial: string;
			readonly keyCode: string;
	  };

export class SpeechHttp extends Context.Tag("@open-quake/edge/SpeechHttp")<
	SpeechHttp,
	{
		readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	}
>() {}
export interface SpeechSocket {
	readonly send: (data: string | Uint8Array) => Effect.Effect<void, AiError>;
	/** Decoded JSON object, or a raw JSON string. Close/error must fail this wait. */
	readonly receive: Effect.Effect<unknown, AiError>;
	readonly close: Effect.Effect<void>;
}
export class SpeechWebSocket extends Context.Tag(
	"@open-quake/edge/SpeechWebSocket",
)<
	SpeechWebSocket,
	{
		readonly connect: (input: {
			readonly url: string;
			readonly headers: Readonly<Record<string, string>>;
			readonly signal: AbortSignal;
		}) => Effect.Effect<SpeechSocket, AiError>;
	}
>() {}
/** Host implementation owns the audio context/object URL and resolves play on natural drain. */
export class SpeechOutput extends Context.Tag("@open-quake/edge/SpeechOutput")<
	SpeechOutput,
	{
		/** Stop/suspend all host audio before recognition. Never resume it automatically. */
		readonly suspendForCapture: Effect.Effect<void, AiError>;
		/** Production shared ownership, held until recognition finalizes on every exit. */
		readonly capture?: Effect.Effect<
			{ readonly stop: Effect.Effect<void> },
			AiError
		>;
		readonly acquireFor?: (
			target: SpeechOutputTarget,
		) => Effect.Effect<SpeechPlaybackLease, AiError>;
		readonly acquire: Effect.Effect<SpeechPlaybackLease, AiError>;
	}
>() {}

export interface SpeechPlaybackLease {
	readonly ready: Effect.Effect<void, AiError>;
	readonly contextState?: Effect.Effect<string, AiError>;
	readonly resume?: Effect.Effect<void, AiError>;
	readonly play: (audio: GeneratedAudio) => Effect.Effect<void, AiError>;
	readonly stop: Effect.Effect<void>;
}

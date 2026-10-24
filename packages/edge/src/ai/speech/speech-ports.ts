import { Context, type Effect } from "effect";
import type { AiError } from "../ai-errors.js";
import type { GeneratedAudio } from "./speech-contracts.js";

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
		readonly acquire: Effect.Effect<
			{
				readonly ready: Effect.Effect<void, AiError>;
				readonly play: (audio: GeneratedAudio) => Effect.Effect<void, AiError>;
				readonly stop: Effect.Effect<void>;
			},
			AiError
		>;
	}
>() {}

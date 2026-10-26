import { Context, type Effect } from "effect";
import type { AiError } from "../ai-errors.js";
/** Host-owned allowlist executor. Declaring tools never grants host execution. */
export class AiToolBridge extends Context.Tag("@open-quake/edge/AiToolBridge")<
	AiToolBridge,
	{
		readonly execute: (
			name: string,
			input: unknown,
			signal: AbortSignal,
		) => Effect.Effect<string, AiError>;
	}
>() {}

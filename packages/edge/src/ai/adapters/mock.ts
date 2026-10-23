import { Effect, Stream } from "effect";
import type { NormalizedEvent } from "../ai-contracts.js";

/** Fixed output, no prompt echo, no network, and Effect Clock rather than host timers. */
export const mockEvents = (): Stream.Stream<NormalizedEvent> =>
	Stream.fromIterable<NormalizedEvent>([
		{ _tag: "textDelta", textDelta: "Mock ", kind: "generation" },
		{ _tag: "textDelta", textDelta: "generation.", kind: "generation" },
		{
			_tag: "usage",
			usage: { inputTokens: 0, outputTokens: 4, provenance: "estimated" },
		},
		{ _tag: "completed" },
	]).pipe(Stream.mapEffect((event) => Effect.sleep(10).pipe(Effect.as(event))));

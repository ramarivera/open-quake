import { Clock, Effect, Schedule, Stream } from "effect";
import type { ClockSnapshot } from "./display-contracts.js";
import { clockSnapshot } from "./display-invariants.js";

/** One host snapshot is fanned out to panel and preview by the desktop edge. */
export const displayClock: Stream.Stream<ClockSnapshot> =
	Stream.repeatEffectWithSchedule(
		Clock.currentTimeMillis.pipe(Effect.map(clockSnapshot)),
		Schedule.spaced("1 second"),
	);

import { Context, type Effect } from "effect";
import type { ClockTarget } from "../../shared/clock-contracts";
import type { ClockPersistenceFailed } from "../../shared/clock-errors";
import type { ClockRecord } from "./clock-store";

/** Production persistence belongs to the single profile repository. */
export class ClockProfiles extends Context.Tag("ClockProfiles")<
	ClockProfiles,
	{
		readonly read: (
			target?: ClockTarget,
		) => Effect.Effect<ClockRecord, ClockPersistenceFailed>;
		readonly write: (
			record: ClockRecord,
		) => Effect.Effect<void, ClockPersistenceFailed>;
	}
>() {}

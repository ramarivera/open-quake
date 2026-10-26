import { Effect, Option } from "effect";
import type { ToastKey } from "../../../../../packages/edge/src/voice/surface/voice-surface-contracts";

/** Reads the process owner on every attempt, including the delayed grid acquisition. */
export function meetingAdmission(
	snapshot: () => Promise<{
		readonly records: readonly { readonly state: string }[];
		readonly translating: boolean;
	}>,
) {
	return (): Effect.Effect<Option.Option<ToastKey>> =>
		Effect.promise(snapshot).pipe(
			Effect.map((state) =>
				state.translating
					? Option.some("meetingAssistantPrompt.liveTranslateActive" as const)
					: state.records.some(
								(record) =>
									record.state === "recording" || record.state === "processing",
							)
						? Option.some("meetingAssistantPrompt.meetingActive" as const)
						: Option.none(),
			),
		);
}

import { Cause, Effect, Option, Runtime } from "effect";
import type { ToastKey } from "../../../../../packages/edge/src/voice/surface/voice-surface-contracts";
import { VoiceSurfaceRequestFailed } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors";

/** Reads the process owner on every attempt, including the delayed grid acquisition. */
export function meetingAdmission(
	snapshot: () => Promise<{
		readonly records: readonly { readonly state: string }[];
		readonly translating: boolean;
	}>,
) {
	return (): Effect.Effect<Option.Option<ToastKey>> =>
		Effect.tryPromise({
			try: snapshot,
			catch: (cause) =>
				new VoiceSurfaceRequestFailed(
					Runtime.isFiberFailure(cause)
						? Cause.squash(cause[Runtime.FiberFailureCauseId])
						: cause,
				),
		}).pipe(
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
			Effect.catchTag("VoiceSurfaceRequestFailed", (error) =>
				Effect.logWarning("Voice admission state unavailable", error).pipe(
					Effect.as(Option.some("aiIconViewTxt.busyToast" as const)),
				),
			),
		);
}

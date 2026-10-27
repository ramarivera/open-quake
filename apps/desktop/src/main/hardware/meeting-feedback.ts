import { Effect, Option } from "effect";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service";
import type { MeetingSnapshot } from "../../../../../packages/edge/src/meetings/meeting-contracts";
import type { MeetingProgressEvent } from "../../../../../packages/edge/src/meetings/meeting-ports";

/** Accepted transitions only. Reads and replayed terminal progress never make sound. */
export function meetingHardwareFeedback(
	hardware: (serial?: string) => HardwareSession | undefined,
) {
	const processing = new Map<string, {serial: string; session: string}>();
	const play = (serial: string | undefined, name: "firework" | "success", expectedSession?: string) =>
		Effect.gen(function* () {
			const session = hardware(serial);
			if (!session) return;
			const state = yield* session.snapshot();
			if (!state.available || (serial && state.serial !== serial) || (expectedSession && state.session !== expectedSession)) return;
			yield* session.playTone(name);
		}).pipe(Effect.catchAll((error) => Effect.logWarning(error.code)));
	return {
        stage: (event: MeetingProgressEvent) => Effect.gen(function* () {
            if (event.stage !== 5) return;
            if (event.status === 1) {
                const serial = event.origin?.serial;
                const owner = serial && hardware(serial);
                const state = owner ? yield* owner.snapshot() : undefined;
                if (serial && state?.available && state.serial === serial) processing.set(event.meetingId, {serial, session: state.session});
                return;
            }
            const target = processing.get(event.meetingId);
            processing.delete(event.meetingId);
            if (event.status === 2 && target) yield* play(target.serial, "success", target.session);
        }),
		mark: (before: MeetingSnapshot, next: MeetingSnapshot, serial: string) =>
			Effect.suspend(() => {
				const changed = next.records.some((record) => {
					const old = before.records.find((r) => r.id === record.id);
					return (
						old &&
						(old.marks.length !== record.marks.length ||
							Option.getOrUndefined(
								old.marks.at(-1)?.endMs ?? Option.none(),
							) !==
								Option.getOrUndefined(
									record.marks.at(-1)?.endMs ?? Option.none(),
								))
					);
				});
				return changed ? play(serial, "firework") : Effect.void;
			}),
	};
}

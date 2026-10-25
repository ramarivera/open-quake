import { Effect } from "effect";
import {
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import type { VolumeReading } from "../../../../../packages/device/src/knob/model/contracts.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";

/** One sequential read per second while armed. Reads never infer writes. */
export const observeVolume = (
	read: Effect.Effect<VolumeReading, KnobError>,
	connected: () => boolean,
): Effect.Effect<never, never, KnobModel> =>
	Effect.suspend(() => {
		let previousFailure: string | undefined;
		const sample = Effect.fn("DesktopKnob.observeVolume")(
			function* (): Effect.fn.Return<void, KnobError, KnobModel> {
				if (!connected()) {
					previousFailure = undefined;
					return;
				}
				const before = yield* KnobModel.snapshot();
				if (before.volume.phase !== "active") {
					previousFailure = undefined;
					return;
				}
				const reading = yield* read.pipe(
					Effect.timeoutFail({
						duration: 3000,
						onTimeout: () =>
							KnobDispatchFailed.fromCause(
								Object.assign(new Error("Volume read timed out"), {
									code: "ETIMEDOUT",
								}),
							),
					}),
				);
				previousFailure = undefined;
				const after = yield* KnobModel.snapshot();
				if (
					!connected() ||
					after.context.session.sessionId !==
						before.context.session.sessionId ||
					after.volume.phase !== "active" ||
					after.volume.level !== before.volume.level ||
					after.volume.muted !== before.volume.muted
				)
					return;
				yield* KnobModel.dispatch({
					_tag: "ObservedVolume",
					sessionId: before.context.session.sessionId,
					...reading,
				});
			},
		);
		return Effect.forever(
			sample().pipe(
				Effect.catchAll((error) => {
					if (previousFailure === error.code) return Effect.void;
					previousFailure = error.code;
					return Effect.logWarning(error);
				}),
				Effect.zipRight(Effect.sleep(1000)),
			),
		);
	});

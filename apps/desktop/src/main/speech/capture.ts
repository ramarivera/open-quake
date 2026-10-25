import { Chunk, Effect, Option, Stream } from "effect";
import type { AiError } from "../../../../../packages/edge/src/ai/ai-errors";
import { AiUnavailable } from "../../../../../packages/edge/src/ai/ai-errors";
import { DesktopSpeechError } from "./errors";
import type { PcmFrame } from "./pcm";

export interface CaptureSession {
	readonly pull: Effect.Effect<
		{ readonly frames: readonly PcmFrame[]; readonly done: boolean },
		AiError | DesktopSpeechError
	>;
	/** Releases physical tracks first, leaving only a bounded final PCM tail to drain. */
	readonly stop: Effect.Effect<void>;
	readonly close: Effect.Effect<void>;
}
export interface CaptureDriver {
	readonly permission: Effect.Effect<boolean, AiError>;
	readonly open: (
		captureId: string,
	) => Effect.Effect<CaptureSession, AiError | DesktopSpeechError>;
}
/** The stream is acquired by STT only AFTER task-started. No eager microphone opening. */
export function captureFrames(
	driver: CaptureDriver,
	captureId: string,
	ready: (session: CaptureSession) => Effect.Effect<void>,
	meter: (frame: PcmFrame) => Effect.Effect<void>,
): Stream.Stream<Uint8Array, AiError> {
	return Stream.unwrapScoped(
		Effect.gen(function* () {
			const session = yield* Effect.acquireRelease(
				driver.open(captureId).pipe(
					Effect.interruptible,
					Effect.timeoutFail({
						duration: "10 seconds",
						onTimeout: () => new DesktopSpeechError("PhaseTimeout", "recorder"),
					}),
				),
				(value) => value.close,
			);
			yield* ready(session);
			let nextSequence = 0;
			return Stream.repeatEffectChunkOption(
				Effect.gen(function* () {
					const batch = yield* session.pull.pipe(Effect.mapError(Option.some));
					if (batch.frames.length > 250)
						return yield* Effect.fail(
							Option.some(new DesktopSpeechError("BufferOverflow", "capture")),
						);
					for (const frame of batch.frames) {
						if (
							frame.captureId !== captureId ||
							frame.seq !== nextSequence++ ||
							frame.bytes.length > 960 ||
							frame.bytes.length === 0 ||
							frame.bytes.length % 2 ||
							frame.rms < 0 ||
							frame.rms > 1
						)
							return yield* Effect.fail(Option.some(new AiUnavailable()));
						yield* meter(frame);
					}
					if (batch.done && !batch.frames.length)
						return yield* Effect.fail(Option.none());
					if (!batch.frames.length) yield* Effect.sleep("20 millis");
					return Chunk.fromIterable(batch.frames.map((frame) => frame.bytes));
				}),
			);
		}),
	).pipe(
		Stream.mapError((error) =>
			error instanceof DesktopSpeechError ? new AiUnavailable(error) : error,
		),
	);
}

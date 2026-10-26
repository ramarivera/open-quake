import { Context, Effect, Option, Schema } from "effect";
import type {
	MeetingConfig,
	Segment,
	Translation,
} from "../meetings/meeting-contracts.js";
import { Segment as SegmentSchema } from "../meetings/meeting-contracts.js";
import { type MeetingError, meetingError } from "../meetings/meeting-errors.js";
import { asrPlan, asrTimeout } from "../meetings/meeting-invariants.js";

export interface MeetingAsrRequest {
	readonly audioRef: string;
	readonly durationMs: number;
	readonly config: MeetingConfig;
	readonly channelIds: readonly number[];
	readonly diarization: boolean;
	readonly expiresInMs: number;
}
export type MeetingAsrResult =
	| { readonly status: "pending" }
	| { readonly status: "complete"; readonly segments: readonly Segment[] };
/** Provider-owned port. Credentials, upload policy and native SDK types stay behind it. */
export interface MeetingAdapter {
	readonly prepare?: (
		config: MeetingConfig,
	) => Effect.Effect<void, MeetingError>;
	readonly cleanup?: (ref: string) => Effect.Effect<void, MeetingError>;
	readonly files?: {
		readonly list: (
			ref: string,
		) => Effect.Effect<readonly Record<string, unknown>[], MeetingError>;
		readonly upload: (
			ref: string,
			text: string,
		) => Effect.Effect<string, MeetingError>;
		readonly remove: (
			ref: string,
			id: string,
		) => Effect.Effect<void, MeetingError>;
	};
	readonly prepareTranslation?: (
		config: MeetingConfig,
	) => Effect.Effect<void, MeetingError>;
	readonly submit: (
		request: MeetingAsrRequest,
	) => Effect.Effect<string, MeetingError>;
	readonly poll: (
		task: string,
	) => Effect.Effect<MeetingAsrResult, MeetingError>;
	readonly cancel: (task: string) => Effect.Effect<void>;
	readonly translate: (
		config: MeetingConfig,
		pcm: Uint8Array,
	) => Effect.Effect<readonly Translation[], MeetingError>;
	readonly stopTranslation: () => Effect.Effect<void>;
}
export class AiMeetingAdapter extends Context.Tag(
	"@open-quake/edge/AiMeetingAdapter",
)<AiMeetingAdapter, MeetingAdapter>() {}
export const transcribeMeeting = Effect.fn(
	"AiProviderService.transcribeMeeting",
)(function* (
	adapter: Option.Option<MeetingAdapter>,
	config: MeetingConfig,
	audioRef: string,
	durationMs: number,
	progress: (stage: 2 | 3, status: 1 | 2) => Effect.Effect<void> = () =>
		Effect.void,
): Effect.fn.Return<readonly Segment[], MeetingError> {
	if (Option.isNone(adapter)) return yield* meetingError("Unavailable");
	const port = adapter.value;
	const work = progress(2, 1).pipe(
		Effect.zipRight(
			Effect.acquireUseRelease(
				port
					.submit({
						config,
						audioRef,
						durationMs,
						channelIds: asrPlan.channelIds,
						diarization: true,
						expiresInMs: asrPlan.uploadExpiryMs,
					})
					.pipe(
						Effect.interruptible,
						Effect.onInterrupt(() => port.cancel(audioRef)),
						Effect.tap(() => progress(2, 2)),
					),
				(task) =>
					Effect.gen(function* () {
						yield* progress(3, 1);
						while (true) {
							const result = yield* port.poll(task);
							if (result.status === "complete") {
								const segments = yield* Schema.decodeUnknown(
									Schema.Array(SegmentSchema),
								)(result.segments).pipe(
									Effect.mapError((cause) =>
										meetingError("TranscriptionFailed", cause),
									),
								);
								if (!segments.some((s) => s.text.trim()))
									return yield* meetingError("NoValidSpeech");
								if (segments.some((s) => s.endMs < s.startMs))
									return yield* meetingError("TranscriptionFailed");
								yield* progress(3, 2);
								return [...segments].sort((a, b) => a.startMs - b.startMs);
							}
							yield* Effect.sleep(asrPlan.pollMs);
						}
					}),
				(task, exit) =>
					exit._tag === "Failure" ? port.cancel(task) : Effect.void,
			),
		),
	);
	return yield* work.pipe(
		Effect.timeoutFail({
			duration: asrTimeout(config.asrProvider, durationMs),
			onTimeout: () => meetingError("Timeout"),
		}),
	);
});

import { Effect } from "effect";

export interface CaptureMetrics {
	readonly terminal: "completed" | "empty" | "failed" | "cancelled";
	readonly startupMs: number;
	readonly readyLatencyMs: number | null;
	readonly firstFrameLatencyMs: number | null;
	readonly captureDurationMs: number;
	readonly hasAudioFrame: boolean;
	readonly stopBeforeReady: boolean;
}
const bounded = (value: number) =>
	Number.isFinite(value) ? Math.round(Math.min(120000, Math.max(0, value))) : 0;
/** Closed projection also protects callers supplying structurally wider objects. */
export const safeCaptureMetrics = (value: CaptureMetrics): CaptureMetrics => ({
	terminal: ["completed", "empty", "failed", "cancelled"].includes(
		value.terminal,
	)
		? value.terminal
		: "failed",
	startupMs: bounded(value.startupMs),
	readyLatencyMs:
		value.readyLatencyMs === null ? null : bounded(value.readyLatencyMs),
	firstFrameLatencyMs:
		value.firstFrameLatencyMs === null
			? null
			: bounded(value.firstFrameLatencyMs),
	captureDurationMs: bounded(value.captureDurationMs),
	hasAudioFrame: value.hasAudioFrame === true,
	stopBeforeReady: value.stopBeforeReady === true,
});
/** Relative monotonic times only. No capture IDs, wall-clock times or device names. */
export const createCaptureMetrics = Effect.fn("DesktopSpeech.captureMetrics")(
	function* () {
		const clock = yield* Effect.clock;
		const started = clock.unsafeCurrentTimeNanos();
		const now = () => Number(clock.unsafeCurrentTimeNanos() - started) / 1e6;
		let ready: number | undefined;
		let first: number | undefined;
		let stopped: number | undefined;
		let stopBeforeReady = false;
		return {
			ready: Effect.sync(() => {
				ready ??= now();
			}),
			frame: Effect.sync(() => {
				first ??= now();
			}),
			stop: Effect.sync(() => {
				stopped ??= now();
				stopBeforeReady ||= ready === undefined;
			}),
			finish: (terminal: CaptureMetrics["terminal"]) =>
				Effect.sync(() =>
					safeCaptureMetrics({
						terminal,
						startupMs: now(),
						readyLatencyMs: ready ?? null,
						firstFrameLatencyMs: first ?? null,
						captureDurationMs:
							ready === undefined ? 0 : (stopped ?? now()) - ready,
						hasAudioFrame: first !== undefined,
						stopBeforeReady,
					}),
				),
		};
	},
);

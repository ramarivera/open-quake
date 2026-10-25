import { Effect, Fiber } from "effect";
import type { TtsProfile } from "../../../../../packages/edge/src/ai/speech/speech-contracts";
import type {
	AiSpeechService,
	SpeechOutcome,
	SpeechTurn,
} from "../../../../../packages/edge/src/ai/speech/speech-service";
import { instrumentSpeechOutcome, type SpeechDiagnostics } from "./diagnostics";
import { DesktopSpeechError } from "./errors";

/** One turn owns its unsaid text, one speaker, and a two-second pending-text timer. */
export const createOrderedSpeech = Effect.fn("DesktopSpeech.ordered")(
	function* (options: {
		readonly speech: Pick<AiSpeechService, "createSpeech">;
		readonly profile: TtsProfile;
		readonly report: (error: { readonly code: string }) => Effect.Effect<void>;
		readonly instrument?: SpeechDiagnostics["instrument"] | undefined;
	}) {
		const scope = yield* Effect.scope;
		const gate = yield* Effect.makeSemaphore(1);
		let text = "";
		let queued = 0;
		let ended = false;
		let failed = false;
		let current: SpeechTurn | undefined;
		let worker: Fiber.RuntimeFiber<void> | undefined;
		let timer: Fiber.RuntimeFiber<void> | undefined;
		const segments: string[] = [];
		const cancel = Effect.fn("DesktopSpeech.cancelOrdered")(function* () {
			ended = true;
			failed = true;
			text = "";
			segments.length = 0;
			queued = 0;
			if (current) yield* current.cancel();
			if (worker) yield* Fiber.interrupt(worker);
			if (timer) yield* Fiber.interrupt(timer);
		});
		const drain = Effect.gen(function* () {
			while (!failed && segments.length) {
				const segment = segments.shift();
				if (!segment) continue;
				current = yield* options.speech.createSpeech(options.profile, segment);
				const outcome = yield* instrumentSpeechOutcome(
					current.result,
					options.instrument,
				);
				queued -= segment.length;
				current = undefined;
				if (outcome._tag !== "completed") {
					failed = true;
					text = "";
					segments.length = 0;
					queued = 0;
					if (outcome._tag === "textOnly") yield* options.report(outcome.error);
				}
			}
		}).pipe(
			Effect.ensuring(
				Effect.sync(() => {
					worker = undefined;
				}),
			),
		);
		const flush = Effect.fn("DesktopSpeech.flushOrdered")(function* (
			all: boolean,
		) {
			if (failed) return;
			while (text.length) {
				const boundary = text.search(/[.!?。！？\n]/);
				const take =
					boundary >= 0 && boundary < 200
						? boundary + 1
						: text.length >= 200
							? 200
							: all
								? text.length
								: 0;
				if (!take) break;
				segments.push(text.slice(0, take));
				text = text.slice(take);
			}
			if (!worker && segments.length) {
				const start = yield* Effect.makeLatch();
				worker = yield* start.await.pipe(
					Effect.zipRight(drain),
					Effect.forkIn(scope),
				);
				yield* start.open;
			}
		});
		return {
			push: Effect.fn("DesktopSpeech.pushOrdered")(
				(delta: string): Effect.Effect<void> =>
					gate.withPermits(1)(
						Effect.gen(function* () {
							if (ended || failed || !delta) return;
							if (queued + delta.length > 4000) {
								yield* cancel();
								yield* options.report(
									new DesktopSpeechError("QueueFull", "speech"),
								);
								return;
							}
							queued += delta.length;
							text += delta;
							yield* flush(false);
							if (!text.length && timer) {
								yield* Fiber.interrupt(timer);
								timer = undefined;
							}
							if (text.length && !timer)
								timer = yield* Effect.sleep("2 seconds").pipe(
									Effect.zipRight(
										gate.withPermits(1)(
											Effect.gen(function* () {
												timer = undefined;
												yield* flush(true);
											}),
										),
									),
									Effect.forkIn(scope),
								);
						}),
					),
			),
			finish: Effect.fn("DesktopSpeech.finishOrdered")(function* (
				outcome: "completed" | "cancelled" | "failed",
			) {
				if (outcome !== "completed") return yield* cancel();
				yield* gate.withPermits(1)(
					Effect.gen(function* () {
						if (ended) return;
						ended = true;
						if (timer) {
							yield* Fiber.interrupt(timer);
							timer = undefined;
						}
						yield* flush(true);
					}),
				);
			}),
			cancel,
			settled: Effect.suspend(() =>
				worker ? Fiber.join(worker) : Effect.void,
			),
		};
	},
);
export type OrderedSpeech = Effect.Effect.Success<
	ReturnType<typeof createOrderedSpeech>
>;
export type { SpeechOutcome };

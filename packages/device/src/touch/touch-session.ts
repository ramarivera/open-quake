import { Effect, Fiber, Option, type Scope } from "effect";
import { TOUCH_IDLE_UP_MS, type TrackedTouchPoint } from "./touch-contracts.js";
import { createTouchTracker, parseTouchReport } from "./touch-invariants.js";

/** One contact tracker + one resettable deadline per owning connection scope. */
export const makeTouchSession = Effect.fn("TouchInput.session")(function* (
	emit: (points: readonly TrackedTouchPoint[]) => Effect.Effect<void>,
): Effect.fn.Return<
	{
		readonly report: (bytes: Uint8Array) => Effect.Effect<boolean>;
		readonly release: () => Effect.Effect<void>;
		readonly setCaptureActive: (active: boolean) => Effect.Effect<void>;
	},
	never,
	Scope.Scope
> {
	const tracker = createTouchTracker();
	let capture = false;
	let timer = Option.none<Fiber.RuntimeFiber<void>>();
	const release = Effect.fn("TouchInput.release")(
		function* (): Effect.fn.Return<void> {
			const points = tracker.release();
			if (points.length) yield* emit(points);
		},
	);
	// Fork into this scope, including when invoked from a renderer/transport fiber.
	const scope = yield* Effect.scope;
	const rearm = Effect.fn("TouchInput.rearm")(
		function* (): Effect.fn.Return<void> {
			if (Option.isSome(timer)) yield* Fiber.interrupt(timer.value);
			timer = Option.none();
			if (!capture)
				timer = Option.some(
					yield* Effect.sleep(TOUCH_IDLE_UP_MS).pipe(
						Effect.zipRight(release()),
						Effect.forkIn(scope),
					),
				);
		},
	);
	yield* Effect.addFinalizer(release);
	return {
		report: Effect.fn("TouchInput.report")(function* (
			bytes: Uint8Array,
		): Effect.fn.Return<boolean> {
			const parsed = parseTouchReport(bytes);
			if (Option.isNone(parsed)) return false;
			const points = tracker.frame(parsed.value);
			if (points.length) yield* emit(points);
			yield* rearm();
			return true;
		}),
		release: Effect.fn("TouchInput.reset")(
			function* (): Effect.fn.Return<void> {
				if (Option.isSome(timer)) yield* Fiber.interrupt(timer.value);
				timer = Option.none();
				yield* release();
			},
		),
		setCaptureActive: Effect.fn("TouchInput.setCaptureActive")(function* (
			active: boolean,
		): Effect.fn.Return<void> {
			capture = active;
			yield* rearm();
		}),
	};
});

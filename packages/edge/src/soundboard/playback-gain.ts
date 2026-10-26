import { Clock, Effect, Exit, Fiber, Option, type Scope } from "effect";
import { SoundboardDecodeFailed } from "./soundboard-errors.js";

/** One track's ramp. Cancelling awaits its final native write before a successor starts. */
export const makeSoundGain = (options: {
	readonly scope: Scope.Scope;
	readonly current: () => boolean;
	readonly read: () => number;
	readonly write: (
		value: number,
	) => Effect.Effect<void, SoundboardDecodeFailed>;
}) =>
	Effect.gen(function* () {
		const gate = yield* Effect.makeSemaphore(1);
		let epoch = 0;
		let pending =
			Option.none<Fiber.RuntimeFiber<boolean, SoundboardDecodeFailed>>();
		const cancel = Effect.uninterruptible(
			gate.withPermits(1)(
				Effect.gen(function* () {
					const cancelled = ++epoch;
					const previous = pending;
					pending = Option.none();
					if (Option.isSome(previous)) yield* Fiber.interrupt(previous.value);
					return cancelled;
				}),
			),
		);
		const to = (
			target: number,
			durationMs: number,
		): Effect.Effect<boolean, SoundboardDecodeFailed> =>
			Effect.gen(function* () {
				const token = yield* cancel;
				const initial = options.read();
				const started = yield* Clock.currentTimeMillis;
				const ramp = Effect.gen(function* () {
					while (options.current() && token === epoch) {
						const elapsed = Math.max(
							0,
							(yield* Clock.currentTimeMillis) - started,
						);
						const fraction =
							durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs);
						yield* options.write(initial + (target - initial) * fraction).pipe(
							Effect.timeoutFail({
								duration: "2 seconds",
								onTimeout: () => new SoundboardDecodeFailed(),
							}),
						);
						if (fraction === 1) return options.current() && token === epoch;
						yield* Effect.sleep(Math.min(20, durationMs - elapsed));
					}
					return false;
				});
				const fiber = yield* Effect.uninterruptibleMask((restore) =>
					gate.withPermits(1)(
						Effect.gen(function* () {
							if (token !== epoch)
								return Option.none<
									Fiber.RuntimeFiber<boolean, SoundboardDecodeFailed>
								>();
							const child = yield* restore(ramp).pipe(
								Effect.forkIn(options.scope),
							);
							pending = Option.some(child);
							return Option.some(child);
						}),
					),
				);
				if (Option.isNone(fiber)) return false;
				const result = yield* Fiber.await(fiber.value).pipe(
					Effect.onInterrupt(() =>
						token === epoch ? cancel.pipe(Effect.asVoid) : Effect.void,
					),
				);
				if (Option.isSome(pending) && pending.value === fiber.value)
					pending = Option.none();
				if (Exit.isSuccess(result)) return result.value;
				if (Exit.isInterrupted(result)) return false;
				return yield* Effect.failCause(result.cause);
			});
		return { cancel, to };
	});

export type SoundGain = Effect.Effect.Success<ReturnType<typeof makeSoundGain>>;

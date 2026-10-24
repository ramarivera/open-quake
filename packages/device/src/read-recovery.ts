import { Clock, Effect, type Fiber, Option, type Scope, Stream } from "effect";
import type { QuakeHidReadFailed } from "./device-errors.js";

/** Native error recognition is confined to this boundary; consumers use catalog tags. */
export function isHidEio(error: QuakeHidReadFailed): boolean {
	const cause = error.originalCause;
	return (
		cause instanceof Error &&
		(("code" in cause && cause.code === "EIO") ||
			cause.message === "could not read from HID device")
	);
}

/** Resubscribe to the same handle after isolated EIO; never reopen it here. */
export const recoverHidReads = Effect.fn("QuakeConnection.recoverReads")(
	function* (
		reports: Stream.Stream<Uint8Array, QuakeHidReadFailed>,
		refresh: Effect.Effect<unknown>,
		terminate: (error: QuakeHidReadFailed) => Effect.Effect<unknown>,
	): Effect.fn.Return<
		Stream.Stream<Uint8Array, QuakeHidReadFailed>,
		never,
		Scope.Scope
	> {
		const scope = yield* Effect.scope;
		let timestamps: number[] = [];
		let fallback = Option.none<Fiber.RuntimeFiber<unknown, never>>();
		const recover = (
			error: QuakeHidReadFailed,
		): Stream.Stream<Uint8Array, QuakeHidReadFailed> =>
			Stream.unwrap(
				Effect.gen(function* () {
					if (!isHidEio(error)) return Stream.fail(error);
					const now = yield* Clock.currentTimeMillis;
					timestamps = [...timestamps.filter((at) => now - at < 10_000), now];
					yield* refresh;
					if (timestamps.length >= 3) return Stream.fail(error);
					if (Option.isNone(fallback)) {
						fallback = Option.some(
							yield* Effect.sleep(30_000).pipe(
								Effect.zipRight(terminate(error)),
								Effect.forkIn(scope),
							),
						);
					}
					return reports.pipe(Stream.catchTag("QuakeHidReadFailed", recover));
				}),
			);
		return reports.pipe(Stream.catchTag("QuakeHidReadFailed", recover));
	},
);

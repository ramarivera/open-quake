import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { MonitorForeground } from "../../../../../packages/edge/src/monitor/monitoring-service";
import { monitorForegroundLive } from "./foreground";

it.scoped(
	"mock mode returns absence and owns no native foreground helper",
	() =>
		Effect.gen(function* () {
			const port = yield* MonitorForeground;
			expect(yield* port.query()).toEqual(Option.none());
			yield* port.stop();
			expect(yield* port.query()).toEqual(Option.none());
		}).pipe(Effect.provide(monitorForegroundLive("win32", true))),
);

it.scoped(
	"coalesces actual probe consumers and kills pending native work on stop",
	() =>
		Effect.gen(function* () {
			let calls = 0;
			const native = (
				_platform: unknown,
				signal?: AbortSignal,
			): Promise<Option.Option<{ id: string; path: string }>> => {
				calls++;
				return new Promise((_resolve, reject) => {
					signal?.addEventListener(
						"abort",
						() => reject(new Error("cancelled private path")),
						{ once: true },
					);
				});
			};
			yield* Effect.gen(function* () {
				const port = yield* MonitorForeground;
				const one = yield* port.query().pipe(Effect.either, Effect.forkScoped);
				const two = yield* port.query().pipe(Effect.either, Effect.forkScoped);
				yield* Effect.yieldNow();
				expect(calls).toBe(1);
				yield* port.stop();
				for (const fiber of [one, two]) {
					const result = yield* Fiber.join(fiber);
					expect(result._tag).toBe("Left");
					if (result._tag === "Left") {
						expect(result.left._tag).toBe("MonitorCollectionFailed");
						expect(JSON.stringify(result.left)).not.toContain("private");
					}
				}
			}).pipe(Effect.provide(monitorForegroundLive("darwin", false, native)));
		}),
);

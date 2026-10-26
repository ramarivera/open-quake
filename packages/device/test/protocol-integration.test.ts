import { describe, expect, it } from "@effect/vitest";
import * as protocol from "@open-quake/protocol";
import { Cause, Effect, Either, Fiber, Layer, Stream, TestClock } from "effect";
import { afterEach, vi } from "vitest";
import { QuakeDevice } from "../src/device-service.js";
import { makeFakeHidTransport } from "../src/hid-fake.js";
import { report } from "./reports.js";

afterEach(() => vi.restoreAllMocks());

describe("protocol kernel consumed by the conductor", () => {
	for (const direction of ["read", "write"] as const) {
		it.scoped(
			`preserves the exact kernel ${direction} error and closes the connection`,
			() =>
				Effect.gen(function* () {
					const fake = yield* makeFakeHidTransport();
					const original = new Error("token=private-protocol-cause");
					const failure = new protocol.ProtocolInputInvalid(original);
					const codec = vi.spyOn(
						protocol,
						direction === "read" ? "unwrapShortCommand" : "wrapShortCommand",
					);
					codec.mockReturnValueOnce(Either.left(failure));
					yield* Effect.gen(function* () {
						const connection = yield* (yield* QuakeDevice).connect({
							keepAliveIntervalMs: 100,
						});
						const events = yield* connection.subscribe();
						const received: string[] = [];
						const consumer = yield* Stream.runForEach(events, (event) =>
							Effect.sync(() => received.push(event._tag)),
						).pipe(Effect.either, Effect.forkScoped);
						if (direction === "read") yield* fake.emit(report(3, 2, [1]));
						else yield* TestClock.adjust(1000);
						const result = yield* Fiber.join(consumer);
						expect(Either.isLeft(result)).toBe(true);
						if (Either.isLeft(result)) {
							// Effect attaches trace proxies when an error crosses named spans.
							let source = result.left;
							while (source !== Cause.originalError(source))
								source = Cause.originalError(source);
							expect(source === failure).toBe(true);
						}
						expect(failure.code).toBe("QUAKE.PROTOCOL.INPUT_INVALID");
						expect(failure.originalCause).toBe(original);
						expect(Object.keys(failure)).not.toContain("originalCause");
						expect(JSON.stringify(result)).not.toContain(
							"private-protocol-cause",
						);
						expect(received).toEqual(["Disconnect"]);
						expect(codec).toHaveBeenCalledTimes(1);
						expect(yield* fake.closes).toBe(1);
						yield* TestClock.adjust(1000);
						expect(yield* fake.writes).toHaveLength(0);
					}).pipe(
						Effect.provide(
							QuakeDevice.DefaultWithoutDependencies.pipe(
								Layer.provide(fake.layer),
							),
						),
					);
				}),
		);
	}
});

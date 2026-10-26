import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Option } from "effect";
import { vi } from "vitest";
import {
	type AudioWorker,
	createElectronCaptureDriver,
} from "./electron-audio";

vi.mock("electron", () => ({
	app: {},
	BrowserWindow: class {},
	session: {},
	systemPreferences: {},
}));

function gate() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("production recorder startup lifetime", () => {
	for (const name of ["NotAllowedError", "NotReadableError"]) {
		it.effect(
			`awaits worker cleanup and retains ${name} on failed startup`,
			() =>
				Effect.gen(function* () {
					const cause = Object.assign(new Error("private recorder failure"), {
						name,
					});
					const closing = yield* Deferred.make<void>();
					const drain = gate();
					let closed = 0;
					const worker: AudioWorker = {
						invoke: async () => {
							throw cause;
						},
						close: async () => {
							closed++;
							await Effect.runPromise(Deferred.succeed(closing, undefined));
							await drain.promise;
						},
					};
					const fiber = yield* createElectronCaptureDriver(async () => worker)
						.open("capture")
						.pipe(Effect.either, Effect.fork);
					// Yield rather than await closing: the old driver never calls close.
					yield* Effect.yieldNow().pipe(Effect.repeatN(20));
					expect(yield* Deferred.isDone(closing)).toBe(true);
					expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
					drain.resolve();
					const result = yield* Fiber.join(fiber);
					expect(result).toMatchObject({
						_tag: "Left",
						left: {
							code:
								name === "NotAllowedError"
									? "VOICE.CAPTURE.PERMISSION_DENIED"
									: "VOICE.CAPTURE.RECORDER_UNAVAILABLE",
						},
					});
					if (result._tag === "Left")
						expect(result.left.originalCause).toBe(cause);
					expect(closed).toBe(1);
				}),
		);
	}
	it.effect(
		"interruption waits for an acquired worker even while capture invocation is pending",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const drain = gate();
				let closed = 0;
				let signal: AbortSignal | undefined;
				const worker: AudioWorker = {
					invoke: async () => {
						await Effect.runPromise(Deferred.succeed(entered, undefined));
						return await new Promise<never>(() => {});
					},
					close: async () => {
						closed++;
						await drain.promise;
					},
				};
				const fiber = yield* createElectronCaptureDriver(async (value) => {
					signal = value;
					return worker;
				})
					.open("capture")
					.pipe(Effect.fork);
				yield* Deferred.await(entered);
				const stopping = yield* Fiber.interrupt(fiber).pipe(Effect.fork);
				yield* Effect.yieldNow().pipe(Effect.repeatN(20));
				expect(signal?.aborted).toBe(true);
				expect(closed).toBe(1);
				expect(Option.isNone(yield* Fiber.poll(stopping))).toBe(true);
				drain.resolve();
				yield* Fiber.join(stopping);
				expect(closed).toBe(1);
			}),
	);
	it.effect(
		"a late worker closes without ever starting capture after cancellation",
		() =>
			Effect.gen(function* () {
				const entered = yield* Deferred.make<void>();
				const opening = gate();
				const closed = yield* Deferred.make<void>();
				let invoked = 0;
				const worker: AudioWorker = {
					invoke: async <A>() => {
						invoked++;
						return undefined as A;
					},
					close: async () => {
						await Effect.runPromise(Deferred.succeed(closed, undefined));
					},
				};
				const fiber = yield* createElectronCaptureDriver(async () => {
					await Effect.runPromise(Deferred.succeed(entered, undefined));
					await opening.promise;
					return worker;
				})
					.open("capture")
					.pipe(Effect.fork);
				yield* Deferred.await(entered);
				yield* Fiber.interrupt(fiber);
				opening.resolve();
				yield* Deferred.await(closed);
				expect(invoked).toBe(0);
			}),
	);
	it.effect("failed stop and concurrent close share one awaited teardown", () =>
		Effect.gen(function* () {
			const drain = gate();
			let closed = 0;
			const worker: AudioWorker = {
				invoke: async <A>(method: string) => {
					if (method === "stop") throw new Error("stop failed");
					return undefined as A;
				},
				close: async () => {
					closed++;
					await drain.promise;
				},
			};
			const capture = yield* createElectronCaptureDriver(
				async () => worker,
			).open("capture");
			const stopping = yield* capture.stop.pipe(Effect.fork);
			yield* Effect.yieldNow().pipe(Effect.repeatN(20));
			const closing = yield* capture.close.pipe(Effect.fork);
			yield* Effect.yieldNow().pipe(Effect.repeatN(20));
			expect(closed).toBe(1);
			expect(Option.isNone(yield* Fiber.poll(stopping))).toBe(true);
			expect(Option.isNone(yield* Fiber.poll(closing))).toBe(true);
			drain.resolve();
			yield* Fiber.join(stopping);
			yield* Fiber.join(closing);
			yield* capture.close;
			expect(closed).toBe(1);
		}),
	);
});

import { Effect, Layer, Option, Queue, Ref, Stream, Take } from "effect";
import { type HidDeviceInfo, QUAKE_IDENTITY } from "./device-contracts.js";
import {
	QuakeHidOpenFailed,
	QuakeHidReadFailed,
	QuakeHidWriteFailed,
} from "./device-errors.js";
import { type HidConnection, HidTransport } from "./hid-transport.js";

export const FAKE_QUAKE_DEVICE: HidDeviceInfo = {
	path: "fake:quake",
	serialNumber: "fake-quake",
	...QUAKE_IDENTITY,
};

export interface FakeHidTransport {
	readonly layer: Layer.Layer<HidTransport>;
	readonly transport: HidTransport["Type"];
	readonly writes: Effect.Effect<ReadonlyArray<Uint8Array>>;
	readonly opens: Effect.Effect<number>;
	readonly closes: Effect.Effect<number>;
	readonly emit: (report: Uint8Array) => Effect.Effect<void>;
	readonly end: () => Effect.Effect<void>;
	readonly failRead: (cause: unknown) => Effect.Effect<void>;
	readonly failWrite: (cause: unknown) => Effect.Effect<void>;
}

export const makeFakeHidTransport = (
	devices: ReadonlyArray<HidDeviceInfo> = [FAKE_QUAKE_DEVICE],
): Effect.Effect<FakeHidTransport> =>
	Effect.gen(function* () {
		const writes = yield* Ref.make<ReadonlyArray<Uint8Array>>([]);
		const opens = yield* Ref.make(0);
		const closes = yield* Ref.make(0);
		const active = new Set<
			Queue.Queue<Take.Take<Uint8Array, QuakeHidReadFailed>>
		>();
		const writeFailure = yield* Ref.make(Option.none<QuakeHidWriteFailed>());
		const open = Effect.fn("FakeHidTransport.open")(function* (
			info: HidDeviceInfo,
		): Effect.fn.Return<HidConnection, QuakeHidOpenFailed> {
			if (!devices.some((device) => device.path === info.path))
				return yield* new QuakeHidOpenFailed(undefined);
			const queue =
				yield* Queue.unbounded<Take.Take<Uint8Array, QuakeHidReadFailed>>();
			yield* Ref.update(opens, (n) => n + 1);
			active.add(queue);
			let closed = false;
			return {
				reports: Stream.fromQueue(queue).pipe(Stream.flattenTake),
				write: Effect.fn("FakeHidTransport.write")(function* (
					report: Uint8Array,
				): Effect.fn.Return<void, QuakeHidWriteFailed> {
					const failure = yield* Ref.get(writeFailure);
					if (Option.isSome(failure)) return yield* failure.value;
					if (closed || report.length !== 33 || report[0] !== 0)
						return yield* new QuakeHidWriteFailed(undefined);
					yield* Ref.update(writes, (reports) => [...reports, report.slice()]);
				}),
				close: Effect.fn("FakeHidTransport.close")(
					function* (): Effect.fn.Return<void> {
						if (closed) return;
						closed = true;
						active.delete(queue);
						yield* Ref.update(closes, (n) => n + 1);
						yield* Queue.shutdown(queue);
					},
				),
			};
		});
		const transport = HidTransport.of({
			discover: Effect.fn("FakeHidTransport.discover")(
				(): Effect.Effect<ReadonlyArray<HidDeviceInfo>> =>
					Effect.succeed(devices),
			),
			open,
		});
		const broadcast = (
			take: Take.Take<Uint8Array, QuakeHidReadFailed>,
		): Effect.Effect<void> =>
			Effect.forEach(active, (queue) => Queue.offer(queue, take), {
				discard: true,
			});
		return {
			layer: Layer.succeed(HidTransport, transport),
			transport,
			writes: Ref.get(writes),
			opens: Ref.get(opens),
			closes: Ref.get(closes),
			emit: (report: Uint8Array): Effect.Effect<void> =>
				broadcast(Take.of(report.slice())),
			end: (): Effect.Effect<void> => broadcast(Take.end),
			failRead: (cause: unknown): Effect.Effect<void> =>
				broadcast(Take.fail(new QuakeHidReadFailed(cause))),
			failWrite: (cause: unknown): Effect.Effect<void> =>
				Ref.set(writeFailure, Option.some(new QuakeHidWriteFailed(cause))),
		};
	});

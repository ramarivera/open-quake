import { Effect, Layer, Ref, Stream } from "effect";
import type { HidDeviceInfo } from "./device-contracts.js";
import {
	QuakeHidCloseFailed,
	QuakeHidDiscoveryFailed,
	QuakeHidOpenFailed,
	QuakeHidReadFailed,
	QuakeHidWriteFailed,
} from "./device-errors.js";
import { type HidConnection, HidTransport } from "./hid-transport.js";

// Native code loads only when a real transport operation is requested.
const loadHid = () => import("node-hid");

export const NodeHidLive = Layer.succeed(
	HidTransport,
	HidTransport.of({
		discover: Effect.fn("NodeHidTransport.discover")(
			function* (): Effect.fn.Return<
				ReadonlyArray<HidDeviceInfo>,
				QuakeHidDiscoveryFailed
			> {
				return yield* Effect.tryPromise({
					try: async () => {
						const hid = await loadHid();
						const devices = await hid.devicesAsync();
						return devices.flatMap((device) =>
							device.path !== undefined &&
							device.usagePage !== undefined &&
							device.usage !== undefined
								? [
										{
											path: device.path,
											...(device.serialNumber
												? { serialNumber: device.serialNumber }
												: {}),
											vendorId: device.vendorId,
											productId: device.productId,
											usagePage: device.usagePage,
											usage: device.usage,
										},
									]
								: [],
						);
					},
					catch: (cause) => new QuakeHidDiscoveryFailed(cause),
				});
			},
		),
		open: Effect.fn("NodeHidTransport.open")(function* (
			info: HidDeviceInfo,
		): Effect.fn.Return<HidConnection, QuakeHidOpenFailed> {
			const handle = yield* Effect.tryPromise({
				try: async () => {
					const hid = await loadHid();
					return process.platform === "darwin" && info.usagePage === 0xff73
						? hid.HIDAsync.open(info.path, { nonExclusive: true })
						: hid.HIDAsync.open(info.path);
				},
				catch: (cause) => new QuakeHidOpenFailed(cause),
			});
			const closed = yield* Ref.make(false);
			// node-hid can schedule an error between removing the read listener and close.
			const detachedError = (): void => {};
			handle.on("error", detachedError);
			return {
				reports: Stream.asyncPush<Uint8Array, QuakeHidReadFailed>(
					(emit) =>
						Effect.acquireRelease(
							Effect.sync(() => {
								const onData = (data: Uint8Array): void => {
									emit.single(new Uint8Array(data));
								};
								const onError = (cause: unknown): void => {
									emit.fail(new QuakeHidReadFailed(cause));
								};
								handle.on("error", onError);
								handle.on("data", onData);
								return { onData, onError };
							}),
							({ onData, onError }) =>
								Effect.sync(() => {
									handle.removeListener("data", onData);
									handle.removeListener("error", onError);
								}),
						),
					{ bufferSize: "unbounded" },
				),
				write: Effect.fn("NodeHidTransport.write")(function* (
					report: Uint8Array,
				): Effect.fn.Return<void, QuakeHidWriteFailed> {
					if (
						report.length !== 33 ||
						report[0] !== 0 ||
						(yield* Ref.get(closed))
					)
						return yield* new QuakeHidWriteFailed(undefined);
					yield* Effect.tryPromise({
						try: async () => {
							const written = await handle.write(Array.from(report));
							if (written !== report.length)
								throw new RangeError("Incomplete HID report write");
						},
						catch: (cause) => new QuakeHidWriteFailed(cause),
					});
				}),
				close: Effect.fn("NodeHidTransport.close")(
					function* (): Effect.fn.Return<void, QuakeHidCloseFailed> {
						if (yield* Ref.getAndSet(closed, true)) return;
						yield* Effect.tryPromise({
							try: () => handle.close(),
							catch: (cause) => new QuakeHidCloseFailed(cause),
						}).pipe(
							Effect.ensuring(
								Effect.sync(() => {
									handle.removeListener("error", detachedError);
								}),
							),
						);
					},
				),
			};
		}),
	}),
);

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
import { isTouchDevice } from "./touch/touch-contracts.js";

// Native code loads only when a real transport operation is requested.
const loadHid = () => import("node-hid");

export interface NodeHidOptions {
	readonly platform?: NodeJS.Platform;
	readonly framing?: "padded" | "dk-suite";
	readonly enumerateWin32?: () => Promise<readonly HidDeviceInfo[]>;
	readonly onFallback?: (cause: unknown) => void;
}
export function makeNodeHidLayer(options: NodeHidOptions = {}) {
	const platform = options.platform ?? process.platform;
	let native = platform === "win32";
	const enumerate =
		options.enumerateWin32 ??
		(() =>
			import("./win32-enumeration.js").then((module) =>
				module.enumerateWin32(),
			));
	return Layer.succeed(
		HidTransport,
		HidTransport.of({
			discover: Effect.fn("NodeHidTransport.discover")(
				function* (): Effect.fn.Return<
					ReadonlyArray<HidDeviceInfo>,
					QuakeHidDiscoveryFailed
				> {
					return yield* Effect.tryPromise({
						try: async () => {
							if (native) {
								try {
									return await enumerate();
								} catch (cause) {
									native = false;
									options.onFallback?.(cause);
								}
							}
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
						return platform === "darwin"
							? hid.HIDAsync.open(info.path, {
									// macOS reports vendor touch and its pointer usages at one path.
									// Seize only that controller, within the existing touch scope.
									nonExclusive: !isTouchDevice(info),
								})
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
						const header = report[1];
						let bytes = report;
						if (options.framing === "dk-suite") {
							if (header === 0xa3)
								bytes = report.slice(0, (report[2] ?? 0) + 4);
							else if (header === 0xa1)
								bytes = report.slice(
									1,
									(report[2] ?? 0) * 256 + (report[3] ?? 0) + 5,
								);
						}
						for (let attempt = 0; ; attempt++) {
							const written = yield* Effect.tryPromise({
								try: () => handle.write(Array.from(bytes)),
								catch: (cause) => new QuakeHidWriteFailed(cause),
							}).pipe(Effect.either);
							if (written._tag === "Right") {
								if (written.right !== bytes.length)
									return yield* new QuakeHidWriteFailed(
										new RangeError("Incomplete HID report write"),
									);
								return;
							}
							if (platform !== "darwin" || attempt === 2)
								return yield* written.left;
							yield* Effect.sleep(10);
						}
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
}
export const NodeHidLive = makeNodeHidLayer({
	onFallback: () => {
		process.stderr.write(
			"Native Windows HID enumeration failed; using node-hid for this process.\n",
		);
	},
});

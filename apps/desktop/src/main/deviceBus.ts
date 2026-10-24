import { EventEmitter } from "node:events";
import { type DeviceEvent, QuakeDevice } from "@open-quake/device";
import { Effect, Exit, type Scope, Stream } from "effect";
import type {
	DeviceStatusError,
	DeviceStatusEvent,
	QuakeEvent,
} from "../preload/quake";

export type { QuakeEvent } from "../preload/quake";

export type DeviceBus = {
	on(listener: (event: QuakeEvent) => void): () => void;
	currentStatus(): DeviceStatusEvent | undefined;
};

export const DEVICE_RECONNECT_MS = 1000;

/** The caller's scope owns the supervisor and every connection it acquires. */
export const startDeviceBus = Effect.fn("DesktopDeviceBus.start")(
	function* (): Effect.fn.Return<DeviceBus, never, QuakeDevice | Scope.Scope> {
		const device = yield* QuakeDevice;
		const emitter = new EventEmitter<{ event: [event: QuakeEvent] }>();
		let status: DeviceStatusEvent | undefined;
		let sequence = 0;
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => emitter.removeAllListeners()),
		);
		const publish = (event: QuakeEvent): Effect.Effect<void> =>
			Effect.sync(() => {
				if (event.kind === "status") status = event;
				emitter.emit("event", event);
			});
		const reportError = (error: DeviceStatusError): Effect.Effect<void> =>
			publish({
				source: "hid",
				kind: "status",
				state: "error",
				// Catalog policy marks diagnostic messages as not user-facing.
				// Never send the Error object, paths, payloads or native cause.
				error: { _tag: error._tag, code: error.code, category: error.category },
			});
		const forward = (event: DeviceEvent): Effect.Effect<void> => {
			switch (event._tag) {
				case "KnobRotate":
					return publish({
						source: "hid",
						kind: "rotate",
						direction: event.delta,
					});
				case "KnobPress":
					return publish({ source: "hid", kind: "press", state: event.state });
				case "Touch":
					// The device abstraction owns the separately bound vendor touch stream.
					return publish({
						source: "hid",
						kind: "touch",
						points: event.points,
					});
				case "KeepAlive":
					return publish({ source: "hid", kind: "keepalive", seq: ++sequence });
				case "Disconnect":
					return publish({
						source: "hid",
						kind: "status",
						state: "disconnected",
						reason: event.reason,
					});
			}
		};
		const connectAndForward = Effect.scoped(
			Effect.gen(function* () {
				// QuakeDevice filters VID/PID and usagePage/usage, selecting FF60/61
				// rather than the system, consumer or keyboard HID collections.
				const connection = yield* device.connect();
				const events = yield* connection.subscribe();
				let streamFinished = false;
				// Explicit disconnect also exposes native close failures on teardown.
				// On normal termination the stream already carries that same error.
				yield* Effect.addFinalizer(() =>
					connection
						.disconnect()
						.pipe(
							Effect.catchTag("QuakeHidCloseFailed", (error) =>
								streamFinished ? Effect.void : reportError(error),
							),
						),
				);
				yield* publish({ source: "hid", kind: "status", state: "connected" });
				yield* Stream.runForEach(events, forward).pipe(
					Effect.onExit((exit) =>
						Effect.sync(() => {
							streamFinished = !Exit.isInterrupted(exit);
						}),
					),
				);
			}),
		).pipe(
			Effect.matchEffect({
				onSuccess: () => Effect.void,
				onFailure: reportError,
			}),
		);
		yield* Effect.forever(
			connectAndForward.pipe(
				Effect.zipRight(Effect.sleep(DEVICE_RECONNECT_MS)),
			),
		).pipe(Effect.forkScoped);
		return {
			on(listener) {
				emitter.on("event", listener);
				if (status) listener(status);
				return () => emitter.off("event", listener);
			},
			currentStatus: () => status,
		};
	},
);

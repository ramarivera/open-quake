import { EventEmitter } from "node:events";
import {
	type DeviceEvent,
	type DeviceStreamError,
	type QuakeConnection,
	QuakeDevice,
	QuakeDeviceNotFound,
} from "@open-quake/device";
import { Clock, Deferred, Effect, Exit, type Scope, Stream } from "effect";
import type {
	DeviceStatusError,
	DeviceStatusEvent,
	QuakeEvent,
} from "../preload/quake";

export type { QuakeEvent } from "../preload/quake";

export type DeviceBus = {
	on(listener: (event: QuakeEvent) => void): () => void;
	currentStatus(): DeviceStatusEvent | undefined;
	setScreenPower?: (on: boolean) => Effect.Effect<boolean, DeviceStreamError>;
	recover?: (reopen?: boolean) => Effect.Effect<void>;
};

export const DEVICE_RECONNECT_MS = 1000;

/** The caller's scope owns the supervisor and every connection it acquires. */
export const startDeviceBus = Effect.fn("DesktopDeviceBus.start")(
	function* (): Effect.fn.Return<DeviceBus, never, QuakeDevice | Scope.Scope> {
		const device = yield* QuakeDevice;
		const emitter = new EventEmitter<{ event: [event: QuakeEvent] }>();
		let status: DeviceStatusEvent | undefined;
		let sequence = 0;
		let connectionNow: QuakeConnection | undefined;
		let retry = 0;
		let selectedPath: string | undefined;
		let exhaustedPresence: string | undefined;
		let reset = yield* Deferred.make<void>();
		const resetBackoff = Effect.fn("DesktopDeviceBus.recover")(function* (
			reopen = false,
		): Effect.fn.Return<void> {
			if (reopen && connectionNow)
				yield* connectionNow.disconnect().pipe(Effect.ignore);
			retry = 0;
			selectedPath = undefined;
			exhaustedPresence = undefined;
			if (!connectionNow) yield* Deferred.succeed(reset, undefined);
		});
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
				if (selectedPath) {
					const present = yield* device.discover();
					if (!present.some((info) => info.path === selectedPath)) {
						selectedPath = undefined;
						return yield* new QuakeDeviceNotFound();
					}
				}
				const connection = yield* device.connect(
					selectedPath ? { path: selectedPath } : {},
				);
				connectionNow = connection;
				selectedPath = connection.info.path;
				const openedAt = yield* Clock.currentTimeMillis;
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						connectionNow = undefined;
					}),
				);
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
						Clock.currentTimeMillis.pipe(
							Effect.flatMap((now) =>
								Effect.sync(() => {
									if (now - openedAt >= 30_000) retry = 0;
									streamFinished = !Exit.isInterrupted(exit);
								}),
							),
						),
					),
				);
				if ((yield* Clock.currentTimeMillis) - openedAt >= 30_000) retry = 0;
			}),
		).pipe(
			Effect.matchEffect({
				onSuccess: () => Effect.void,
				onFailure: reportError,
			}),
		);
		const wait = (ms: number) =>
			Effect.gen(function* () {
				yield* Effect.raceFirst(Effect.sleep(ms), Deferred.await(reset));
				if (yield* Deferred.isDone(reset)) reset = yield* Deferred.make<void>();
			});
		const scanPresence = device.discover().pipe(
			Effect.map((devices) =>
				devices
					.map((info) => info.path)
					.sort()
					.join("\n"),
			),
			Effect.orElseSucceed(() => ""),
		);
		yield* Effect.forever(
			Effect.gen(function* () {
				if (retry >= 5) {
					const presence = yield* scanPresence;
					if (presence !== exhaustedPresence) {
						retry = 0;
						selectedPath = undefined;
						exhaustedPresence = undefined;
					}
					if (retry >= 5) {
						yield* wait(5000);
						return;
					}
				}
				yield* connectAndForward;
				// Remember the exhausted burst before its final delay, so arrivals
				// during that wait trigger a new burst on the first passive scan.
				if (retry === 4) exhaustedPresence = yield* scanPresence;
				const delay = Math.min(1000 + 2000 * retry++, 30_000);
				yield* wait(delay);
			}),
		).pipe(Effect.forkScoped);
		return {
			on(listener) {
				emitter.on("event", listener);
				if (status) listener(status);
				return () => emitter.off("event", listener);
			},
			currentStatus: () => status,
			recover: resetBackoff,
			setScreenPower: (on) =>
				Effect.suspend(() =>
					connectionNow
						? connectionNow.setScreenPower(on).pipe(Effect.as(true))
						: Effect.succeed(false),
				),
		};
	},
);

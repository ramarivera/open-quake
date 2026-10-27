import { EventEmitter } from "node:events";
import {
	type DeviceEvent,
	type DeviceStreamError,
	type HardwareError,
	type HardwareSession,
	hidSerialFromAlias,
	type QuakeConnection,
	QuakeDevice,
	QuakeDeviceNotFound,
} from "@open-quake/device";
import { Clock, Deferred, Effect, Exit, Schema, Scope, Stream } from "effect";
import type {
	DeviceStatusError,
	DeviceStatusEvent,
	QuakeEvent,
} from "../preload/quake";

export type { QuakeEvent } from "../preload/quake";

export type DeviceBus = {
	on(listener: (event: QuakeEvent, serial?: string) => void): () => void;
	currentStatus(): DeviceStatusEvent | undefined;
	serial?(): string | undefined;
	matrix?(): { readonly row: 1 | 2; readonly col: 8 };
	onLifecycleStatus?: (
		listener: (event: DeviceStatusEvent, serial: string) => void,
	) => () => void;
	device?: (serial: string) => DeviceBus | undefined;
	setScreenPower?: (on: boolean) => Effect.Effect<boolean, DeviceStreamError>;
	hardware?(): HardwareSession | undefined;
    releaseForVia?: () => Effect.Effect<Effect.Effect<void>>;
	recover?: (reopen?: boolean) => Effect.Effect<void>;
};

export const DEVICE_RECONNECT_MS = 1000;

/** The caller's scope owns the supervisor and every connection it acquires. */
export const startDeviceBus = Effect.fn("DesktopDeviceBus.start")(function* (
	attachHardware?: (
		connection: QuakeConnection,
	) => Effect.Effect<HardwareSession, HardwareError, Scope.Scope>,
	selection?: { readonly serial: string },
): Effect.fn.Return<DeviceBus, never, QuakeDevice | Scope.Scope> {
	const device = yield* QuakeDevice;
	const ownerScope = yield* Effect.scope;
	const lifecycleListeners = new Set<
		(event: DeviceStatusEvent, serial: string) => void
	>();
	const secondary = new Map<
		string,
		{ bus: DeviceBus; scope: Scope.CloseableScope }
	>();
	const publishLifecycle = (
		event: DeviceStatusEvent,
		serial: string | undefined,
	) => {
		if (serial)
			for (const listener of lifecycleListeners) listener(event, serial);
	};
	const emitter = new EventEmitter<{
		event: [event: QuakeEvent, serial?: string];
	}>();
	let status: DeviceStatusEvent | undefined;
	let lastSerial: string | undefined;
	let sequence = 0;
	let hardware: HardwareSession | undefined;
	let connectionNow: QuakeConnection | undefined;
	let matrix: { row: 1 | 2; col: 8 } = { row: 2, col: 8 };
	let retry = 0;
    let viaLeased = false;
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
			if (event.kind === "status") {
				status = event;
				publishLifecycle(event, lastSerial ?? "desktop-preview");
			}
			emitter.emit("event", event, lastSerial);
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
			case "Json": {
				const value = event.value;
				const decoded = Schema.decodeUnknownOption(
					Schema.Struct({
						type: Schema.Literal("reportConfig"),
						keyMatrix: Schema.Struct({
							row: Schema.Literal(1, 2),
							col: Schema.Number,
						}),
					}),
				)(value);
				if (decoded._tag === "Some")
					matrix = { row: decoded.value.keyMatrix.row, col: 8 };
				return publish({ source: "hid", kind: "json", value: event.value });
			}
			case "Resource":
				return publish({
					source: "hid",
					kind: "resource",
					envelope: event.envelope,
				});
			case "Matrix":
				return publish({ source: "hid", kind: "matrix", matrix: event.matrix });
			case "HardwareReply":
				return Effect.void;
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
			if (selection) {
				const present = yield* device.discover();
				const current =
					present.find((info) => info.serialNumber === selection.serial) ??
					present.find(
						(info) =>
							info.serialNumber === hidSerialFromAlias(selection.serial),
					);
				if (!current) return yield* new QuakeDeviceNotFound();
				selectedPath = current.path;
			}
			if (!selection && !selectedPath && lastSerial) {
				const present = yield* device.discover();
				const prior =
					present.find((info) => info.serialNumber === lastSerial) ??
					present.find(
						(info) => !info.serialNumber || !secondary.has(info.serialNumber),
					);
				if (!prior) return yield* new QuakeDeviceNotFound();
				selectedPath = prior.path;
			}
			if (selectedPath) {
				const present = yield* device.discover();
				if (!present.some((info) => info.path === selectedPath)) {
					if (selection) return yield* new QuakeDeviceNotFound();
					selectedPath = undefined;
					return yield* new QuakeDeviceNotFound();
				}
			}
			const connection = yield* device.connect(
				selectedPath ? { path: selectedPath } : {},
			);
			connectionNow = connection;
			matrix = { row: 2, col: 8 };
			lastSerial = connection.info.serialNumber;
			selectedPath = connection.info.path;
			const openedAt = yield* Clock.currentTimeMillis;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					connectionNow = undefined;
				}),
			);
			const events = yield* connection.subscribe();
			if (attachHardware && connection.info.serialNumber) {
				const attached = yield* attachHardware(connection).pipe(Effect.either);
				if (attached._tag === "Right") {
					hardware = attached.right;
					yield* hardware.refresh().pipe(
						Effect.matchEffect({
							onSuccess: () => Effect.void,
							onFailure: (error) => Effect.logWarning(error.code),
						}),
						Effect.forkScoped,
					);
				} else yield* Effect.logWarning(attached.left.code);
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						hardware = undefined;
					}),
				);
			}
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
			if (viaLeased) {yield* wait(500); return;}
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
	const missingScans = new Map<string, number>();
	let presenceDelay = 1000;
	if (!selection)
		yield* Effect.forever(
			Effect.suspend(() => Effect.sleep(presenceDelay)).pipe(
				Effect.zipRight(
					Effect.gen(function* () {
						const scan = yield* device.discover().pipe(Effect.either);
						if (scan._tag === "Left") {
							yield* Effect.logWarning(scan.left);
							return;
						}
						const discovered = scan.right;
						let anyMissing = false;
						const primaryPath = connectionNow?.info.path;
						if (primaryPath) {
							if (discovered.some((info) => info.path === primaryPath))
								missingScans.delete(primaryPath);
							else {
								anyMissing = true;
								const count = (missingScans.get(primaryPath) ?? 0) + 1;
								missingScans.set(primaryPath, count);
								if (count >= 2) {
									yield* connectionNow
										?.disconnect()
										.pipe(
											Effect.catchTag("QuakeHidCloseFailed", reportError),
										) ?? Effect.void;
									missingScans.delete(primaryPath);
								}
							}
						}
						const primarySerial = lastSerial ?? discovered[0]?.serialNumber;
						const promote = primarySerial
							? secondary.get(primarySerial)
							: undefined;
						if (promote && primarySerial) {
							secondary.delete(primarySerial);
							yield* Scope.close(promote.scope, Exit.void);
						}
						for (const [serial, entry] of secondary) {
							if (!discovered.some((info) => info.serialNumber === serial)) {
								anyMissing = true;
								const count = (missingScans.get(serial) ?? 0) + 1;
								missingScans.set(serial, count);
								if (count < 2) continue;
								missingScans.delete(serial);
								publishLifecycle(
									{
										source: "hid",
										kind: "status",
										state: "disconnected",
										reason: "scope-closed",
									},
									serial,
								);
								secondary.delete(serial);
								yield* Scope.close(entry.scope, Exit.void);
							} else missingScans.delete(serial);
						}
						presenceDelay = anyMissing ? 2000 : 5000;
						for (const info of discovered) {
							const serial = info.serialNumber;
							if (!serial || serial === primarySerial || secondary.has(serial))
								continue;
							const childScope = yield* Scope.make();
							const child = yield* Scope.extend(
								startDeviceBus(attachHardware, { serial }),
								childScope,
							);
							secondary.set(serial, { bus: child, scope: childScope });
							child.on((event) => {
								if (event.kind === "status") publishLifecycle(event, serial);
								emitter.emit("event", event, serial);
							});
						}
					}),
				),
				Effect.asVoid,
			),
		).pipe(Effect.forkIn(ownerScope));
	yield* Effect.addFinalizer(() =>
		Effect.gen(function* () {
			for (const entry of secondary.values())
				yield* Scope.close(entry.scope, Exit.void);
			secondary.clear();
			lifecycleListeners.clear();
		}),
	);
	const primary: DeviceBus = {
		on(listener) {
			emitter.on("event", listener);
			if (status) listener(status, lastSerial);
			return () => emitter.off("event", listener);
		},
		currentStatus: () => status,
		serial: () => connectionNow?.info.serialNumber ?? lastSerial,
		matrix: () => matrix,
		onLifecycleStatus: (listener) => {
			lifecycleListeners.add(listener);
			if (status) listener(status, lastSerial ?? "desktop-preview");
			for (const [serial, entry] of secondary) {
				const now = entry.bus.currentStatus();
				if (now) listener(now, serial);
			}
			return () => {
				lifecycleListeners.delete(listener);
			};
		},
		device: (serial) =>
			secondary.get(serial)?.bus ??
			(serial === lastSerial ? primary : undefined) ??
			secondary.get(hidSerialFromAlias(serial))?.bus ??
			(hidSerialFromAlias(serial) === lastSerial ? primary : undefined),
		hardware: () => hardware,
        releaseForVia: () => Effect.gen(function* () {
            viaLeased = true;
            if (connectionNow) yield* connectionNow.disconnect().pipe(Effect.ignore);
            return Effect.sync(() => {viaLeased = false;}).pipe(Effect.zipRight(resetBackoff()));
        }),
		recover: resetBackoff,
		setScreenPower: (on) =>
			Effect.suspend(() =>
				connectionNow
					? connectionNow.setScreenPower(on).pipe(Effect.as(true))
					: Effect.succeed(false),
			),
	};
	return primary;
});

import {
	encodeHardwareCommand,
	type HardwareCommand,
	type ProtocolError,
} from "@open-quake/protocol";
import {
	Deferred,
	Effect,
	Either,
	Exit,
	Fiber,
	Option,
	PubSub,
	type Scope,
	Stream,
	Take,
} from "effect";
import {
	type ConnectOptions,
	canonicalHidSerial,
	DEFAULT_KEEP_ALIVE_MS,
	type DeviceEvent,
	type HidDeviceInfo,
	isQuakeDevice,
} from "./device-contracts.js";
import {
	QuakeConnectionClosed,
	QuakeConnectionConfigInvalid,
	QuakeDeviceNotFound,
	type QuakeHidCloseFailed,
	QuakeHidDiscoveryFailed,
	QuakeHidOpenFailed,
	type QuakeHidReadFailed,
	QuakeHidWriteFailed,
} from "./device-errors.js";
import { HidTransport } from "./hid-transport.js";
import { NodeHidLive } from "./node-hid.js";
import {
	keepAliveFrame,
	keepAliveReport,
	makeReportDecoder,
} from "./protocol-adapter.js";
import { recoverHidReads } from "./read-recovery.js";

import { startTouchSource } from "./touch/touch-source.js";

export type DeviceStreamError =
	| QuakeHidReadFailed
	| QuakeHidWriteFailed
	| QuakeHidCloseFailed
	| ProtocolError;
export type DeviceConnectError =
	| QuakeHidDiscoveryFailed
	| QuakeDeviceNotFound
	| QuakeHidOpenFailed
	| QuakeConnectionConfigInvalid;
type DisconnectReason = Extract<DeviceEvent, { _tag: "Disconnect" }>["reason"];
interface Termination {
	readonly reason: DisconnectReason;
	readonly error: Option.Option<DeviceStreamError>;
}

export interface QuakeConnection {
	readonly info: HidDeviceInfo;
    /** Raw QMK exchanges retain this connection's one native handle. */
    readonly exchangeRaw?: (report: Uint8Array, matches: (report: Uint8Array) => boolean) => Effect.Effect<Uint8Array, QuakeHidWriteFailed | QuakeConnectionClosed>;
	readonly sendHardware: (
		command: HardwareCommand,
	) => Effect.Effect<
		void,
		ProtocolError | QuakeHidWriteFailed | QuakeConnectionClosed
	>;
	/** Broadcast stream. Input events are not replayed; termination is replayed. */
	readonly events: Stream.Stream<DeviceEvent, DeviceStreamError>;
	/** Acquire a subscription before generating input, without scheduler races. */
	readonly subscribe: () => Effect.Effect<
		Stream.Stream<DeviceEvent, DeviceStreamError>,
		never,
		Scope.Scope
	>;
	readonly disconnect: () => Effect.Effect<void, QuakeHidCloseFailed>;
	readonly setScreenPower: (
		on: boolean,
	) => Effect.Effect<void, QuakeHidWriteFailed | ProtocolError>;
	readonly touch: {
		readonly setCaptureActive: (active: boolean) => Effect.Effect<void>;
		readonly setLocked: (locked: boolean) => Effect.Effect<void>;
		readonly wake: () => Effect.Effect<void>;
		readonly health: Effect.Effect<
			import("./touch/touch-contracts.js").TouchHealth
		>;
	};
}

export class QuakeDevice extends Effect.Service<QuakeDevice>()(
	"@open-quake/device/QuakeDevice",
	{
		accessors: true,
		dependencies: [NodeHidLive],
		effect: Effect.gen(function* () {
			const transport = yield* HidTransport;
			const sessions = new Map<string, QuakeConnection>();
			const ownership = yield* Effect.makeSemaphore(1);
			const discover = Effect.fn("QuakeDevice.discover")(
				(): Effect.Effect<
					ReadonlyArray<HidDeviceInfo>,
					QuakeHidDiscoveryFailed
				> =>
					Effect.flatMap(transport.discover(), (devices) => {
						const selected = devices.filter(isQuakeDevice).map((info) => ({
							...info,
							...(info.serialNumber
								? { serialNumber: canonicalHidSerial(info.serialNumber) }
								: {}),
						}));
						const seen = new Set<string>();
						for (const info of selected) {
							if (!info.serialNumber) continue;
							if (seen.has(info.serialNumber))
								return Effect.fail(
									new QuakeHidDiscoveryFailed(
										new Error("Ambiguous HID serial"),
									),
								);
							seen.add(info.serialNumber);
						}
						return Effect.succeed(selected);
					}),
			);
			const connect = Effect.fn("QuakeDevice.connect")(function* (
				options: ConnectOptions = {},
			): Effect.fn.Return<QuakeConnection, DeviceConnectError, Scope.Scope> {
				const interval = options.keepAliveIntervalMs ?? DEFAULT_KEEP_ALIVE_MS;
				if (!Number.isFinite(interval) || interval <= 0)
					return yield* new QuakeConnectionConfigInvalid();
				const devices = yield* discover();
				const info = options.path
					? devices.find((device) => device.path === options.path)
					: devices[0];
				if (!info) return yield* new QuakeDeviceNotFound();
				const identity = info.serialNumber ?? info.path;
				const prior = sessions.get(identity);
				if (prior)
					yield* prior
						.disconnect()
						.pipe(
							Effect.catchTag("QuakeHidCloseFailed", (cause) =>
								Effect.fail(new QuakeHidOpenFailed(cause)),
							),
						);
				const events =
					yield* PubSub.unbounded<Take.Take<DeviceEvent, DeviceStreamError>>();
				yield* Effect.addFinalizer(() => PubSub.shutdown(events));
				let sendHardware: QuakeConnection["sendHardware"] = () =>
					Effect.fail(new QuakeConnectionClosed());
				let exchangeRaw: NonNullable<QuakeConnection["exchangeRaw"]> = () => Effect.fail(new QuakeConnectionClosed());
                const touchReady =
					yield* Deferred.make<
						Effect.Effect.Success<ReturnType<typeof startTouchSource>>
					>();
				const ready = yield* Deferred.make<void, QuakeHidOpenFailed>();
				const stopped = yield* Deferred.make<Termination>();
				const finished = yield* Deferred.make<Termination>();
				const closed = yield* Deferred.make<void, QuakeHidCloseFailed>();
				const stop = (
					reason: DisconnectReason,
					error: Option.Option<DeviceStreamError> = Option.none(),
				) => Deferred.succeed(stopped, { reason, error });
				const fail = (error: DeviceStreamError) =>
					stop("error", Option.some(error));
				const lifetime = Effect.scoped(
					Effect.gen(function* () {
						const hardwareWriteLock = yield* Effect.makeSemaphore(1);
						let acceptingWrites = true;
                        let rawPending: { matches: (report: Uint8Array) => boolean; reply: Deferred.Deferred<Uint8Array, QuakeConnectionClosed> } | undefined;
                        yield* Effect.addFinalizer(() => rawPending ? Deferred.fail(rawPending.reply, new QuakeConnectionClosed()) : Effect.void);
						const handle = yield* Effect.acquireRelease(
							transport.open(info),
							(handle) =>
								Effect.sync(() => {
									acceptingWrites = false;
								}).pipe(
									Effect.zipRight(
										hardwareWriteLock.withPermits(1)(
											Deferred.complete(closed, handle.close()),
										),
									),
								),
						);
						sendHardware = Effect.fn("QuakeConnection.sendHardware")(
							(
								command: HardwareCommand,
							): ReturnType<QuakeConnection["sendHardware"]> =>
								hardwareWriteLock.withPermits(1)(
									Effect.gen(function* () {
										if (
											!acceptingWrites ||
											Option.isSome(yield* Deferred.poll(stopped)) ||
											Option.isSome(yield* Deferred.poll(finished))
										)
											return yield* new QuakeConnectionClosed();
										const bytes = yield* encodeHardwareCommand(command);
										// Native promises cannot be cancelled. Teardown drains this lock.
										yield* handle.write(bytes);
										if (command._tag === "Dfu") acceptingWrites = false;
									}).pipe(Effect.uninterruptible),
								),
						);
						exchangeRaw = Effect.fn("QuakeConnection.exchangeRaw")((report, matches) => hardwareWriteLock.withPermits(1)(Effect.gen(function* () {
                            if (!acceptingWrites || Option.isSome(yield* Deferred.poll(stopped))) return yield* new QuakeConnectionClosed();
                            const reply = yield* Deferred.make<Uint8Array, QuakeConnectionClosed>();
                            rawPending = {matches, reply};
                            return yield* handle.write(report).pipe(Effect.uninterruptible, Effect.zipRight(Deferred.await(reply)), Effect.timeoutFail({duration: 1500, onTimeout: () => new QuakeConnectionClosed()}), Effect.onExit((exit) => {
                                rawPending = undefined;
                                return Exit.isFailure(exit) ? stop("error").pipe(Effect.asVoid) : Effect.void;
                            }));
                        })));
                        const write = (report: Uint8Array) =>
							hardwareWriteLock.withPermits(1)(
								Effect.suspend(() =>
									acceptingWrites ? handle.write(report) : Effect.void,
								),
							);
						const reports = yield* recoverHidReads(
							handle.reports,
							discover().pipe(Effect.ignore),
							fail,
						);
						const touch = yield* startTouchSource(transport, (points) =>
							PubSub.publish(
								events,
								Take.of<DeviceEvent>({ _tag: "Touch", points }),
							).pipe(Effect.asVoid),
						);
						yield* Deferred.succeed(touchReady, touch);
						// toPull acquires the incoming stream and its listeners before we signal ready.
						const pull = yield* Stream.toPull(reports);
						const decoder = makeReportDecoder();
						yield* Stream.runForEach(
							Stream.repeatEffectChunkOption(pull),
							(report) => {
								if (rawPending?.matches(report)) return Deferred.succeed(rawPending.reply, report).pipe(Effect.asVoid);
                                const decoded = decoder.push(report);
								if (Either.isLeft(decoded)) return Effect.fail(decoded.left);
								return Option.match(decoded.right, {
									onNone: () => Effect.void,
									onSome: (event) =>
										PubSub.publish(events, Take.of(event)).pipe(Effect.asVoid),
								});
							},
						).pipe(
							Effect.matchEffect({
								onFailure: fail,
								onSuccess: () =>
									decoder.finish().pipe(
										Effect.matchEffect({
											onFailure: fail,
											onSuccess: () => stop("transport-ended"),
										}),
									),
							}),
							Effect.forkScoped,
						);
						const ping = Effect.gen(function* () {
							const report = yield* keepAliveReport();
							for (let attempt = 0; ; attempt++) {
								const result = yield* write(report).pipe(
									Effect.uninterruptible,
									Effect.either,
								);
								if (Either.isRight(result)) return;
								if (attempt === 3) return yield* result.left;
								yield* Effect.sleep(500);
							}
						});
						yield* Effect.sleep(1000).pipe(
							Effect.zipRight(ping),
							Effect.zipRight(
								Effect.forever(
									Effect.sleep(interval).pipe(Effect.zipRight(ping)),
								),
							),
							Effect.matchEffect({
								onFailure: fail,
								onSuccess: () => Effect.void,
							}),
							Effect.forkScoped,
						);
						yield* Deferred.succeed(ready, undefined);
						return yield* Deferred.await(stopped);
					}),
				).pipe(
					Effect.onExit((exit) =>
						Effect.gen(function* () {
							if (Exit.isFailure(exit))
								yield* Deferred.failCause(ready, exit.cause);
							if (Option.isNone(yield* Deferred.poll(closed))) return;
							const closeResult = yield* Effect.either(Deferred.await(closed));
							const termination: Termination = Either.isLeft(closeResult)
								? {
										reason: "error" as const,
										error: Option.some(closeResult.left),
									}
								: Exit.isSuccess(exit)
									? exit.value
									: { reason: "scope-closed" as const, error: Option.none() };
							yield* Deferred.succeed(finished, termination);
							yield* PubSub.publish(
								events,
								Take.of({ _tag: "Disconnect", reason: termination.reason }),
							);
							yield* PubSub.publish(
								events,
								Option.match(termination.error, {
									onNone: () => Take.end,
									onSome: Take.fail,
								}),
							);
						}),
					),
					Effect.catchTag("QuakeHidOpenFailed", () => Effect.void),
				);
				const fiber = yield* Effect.forkScoped(lifetime);
				yield* Deferred.await(ready).pipe(
					Effect.onInterrupt(() => Fiber.interrupt(fiber)),
				);
				const subscribe = Effect.fn("QuakeConnection.subscribe")(
					function* (): Effect.fn.Return<
						Stream.Stream<DeviceEvent, DeviceStreamError>,
						never,
						Scope.Scope
					> {
						// Subscribe before checking termination so a concurrent close cannot be missed.
						const queue = yield* PubSub.subscribe(events);
						const done = yield* Deferred.poll(finished);
						if (Option.isNone(done))
							return Stream.fromQueue(queue).pipe(Stream.flattenTake);
						const { reason, error } = yield* done.value;
						return Stream.succeed<DeviceEvent>({
							_tag: "Disconnect",
							reason,
						}).pipe(
							Stream.concat(
								Option.match(error, {
									onNone: () => Stream.empty,
									onSome: Stream.fail,
								}),
							),
						);
					},
				);
				const connection: QuakeConnection = {
					touch: yield* Deferred.await(touchReady),
					info,
                    exchangeRaw: (report, matches) => exchangeRaw(report, matches),
					sendHardware: (command) => sendHardware(command),
					setScreenPower: (on) =>
						Effect.suspend(() =>
							sendHardware({ _tag: "ScreenPower", on }),
						).pipe(
							Effect.catchTag("QuakeConnectionClosed", (cause) =>
								Effect.fail(new QuakeHidWriteFailed(cause)),
							),
						),
					events: Stream.unwrapScoped(subscribe()),
					subscribe,
					disconnect: Effect.fn("QuakeConnection.disconnect")(
						function* (): Effect.fn.Return<void, QuakeHidCloseFailed> {
							yield* stop("requested");
							yield* Fiber.await(fiber);
							yield* Deferred.await(closed);
						},
					),
				};
				sessions.set(identity, connection);
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						if (sessions.get(identity) === connection)
							sessions.delete(identity);
					}),
				);
				return connection;
			});
			return {
				discover,
				connect: (options?: ConnectOptions) =>
					ownership.withPermits(1)(connect(options)),
				disconnect: Effect.fn("QuakeDevice.disconnect")(
					(
						connection: QuakeConnection,
					): Effect.Effect<void, QuakeHidCloseFailed> =>
						connection.disconnect(),
				),
				// Compatibility with the original skeleton's unpadded protocol vector.
				keepAlivePing: Effect.suspend(keepAliveFrame),
			};
		}),
	},
) {}

export const QuakeDeviceLive = QuakeDevice.Default;

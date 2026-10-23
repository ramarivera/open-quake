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
	DEFAULT_KEEP_ALIVE_MS,
	type DeviceEvent,
	type HidDeviceInfo,
	isQuakeDevice,
} from "./device-contracts.js";
import {
	QuakeConnectionConfigInvalid,
	QuakeDeviceNotFound,
	type QuakeHidCloseFailed,
	type QuakeHidDiscoveryFailed,
	type QuakeHidOpenFailed,
	type QuakeHidReadFailed,
	type QuakeHidWriteFailed,
	type QuakeReportInvalid,
} from "./device-errors.js";
import { HidTransport } from "./hid-transport.js";
import {
	decodeReport,
	keepAliveFrame,
	keepAliveReport,
} from "./protocol-adapter.js";

export type DeviceStreamError =
	| QuakeHidReadFailed
	| QuakeHidWriteFailed
	| QuakeHidCloseFailed
	| QuakeReportInvalid;
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
	/** Broadcast stream. Input events are not replayed; termination is replayed. */
	readonly events: Stream.Stream<DeviceEvent, DeviceStreamError>;
	/** Acquire a subscription before generating input, without scheduler races. */
	readonly subscribe: () => Effect.Effect<
		Stream.Stream<DeviceEvent, DeviceStreamError>,
		never,
		Scope.Scope
	>;
	readonly disconnect: () => Effect.Effect<void, QuakeHidCloseFailed>;
}

export class QuakeDevice extends Effect.Service<QuakeDevice>()(
	"@open-quake/device/QuakeDevice",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			// HidTransport is supplied at the application root, as infrastructure.
			const transport = yield* HidTransport;
			const connect = Effect.fn("QuakeDevice.connect")(function* (
				options: ConnectOptions = {},
			): Effect.fn.Return<QuakeConnection, DeviceConnectError, Scope.Scope> {
				const interval = options.keepAliveIntervalMs ?? DEFAULT_KEEP_ALIVE_MS;
				if (!Number.isFinite(interval) || interval <= 0)
					return yield* new QuakeConnectionConfigInvalid();
				const devices = yield* transport.discover();
				const info = devices.find(isQuakeDevice);
				if (!info) return yield* new QuakeDeviceNotFound();
				const events =
					yield* PubSub.unbounded<Take.Take<DeviceEvent, DeviceStreamError>>();
				yield* Effect.addFinalizer(() => PubSub.shutdown(events));
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
						const handle = yield* Effect.acquireRelease(
							transport.open(info),
							(handle) => Deferred.complete(closed, handle.close()),
						);
						// toPull acquires the incoming stream and its listeners before we signal ready.
						const pull = yield* Stream.toPull(handle.reports);
						yield* Stream.runForEach(
							Stream.repeatEffectChunkOption(pull),
							(report) => {
								const decoded = decodeReport(report);
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
								onSuccess: () => stop("transport-ended"),
							}),
							Effect.forkScoped,
						);
						yield* Effect.forever(
							Effect.sleep(interval).pipe(
								Effect.zipRight(
									handle.write(keepAliveReport()).pipe(Effect.uninterruptible),
								),
							),
						).pipe(
							Effect.catchTag("QuakeHidWriteFailed", fail),
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
				return {
					info,
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
			});
			return {
				connect,
				disconnect: Effect.fn("QuakeDevice.disconnect")(
					(
						connection: QuakeConnection,
					): Effect.Effect<void, QuakeHidCloseFailed> =>
						connection.disconnect(),
				),
				// Compatibility with the original skeleton's unpadded protocol vector.
				keepAlivePing: Effect.sync(keepAliveFrame),
			};
		}),
	},
) {}

export const QuakeDeviceLive = QuakeDevice.Default;

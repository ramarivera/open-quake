import {
	Cause,
	Context,
	Effect,
	Exit,
	Fiber,
	Layer,
	ManagedRuntime,
	Stream,
} from "effect";
import type {
	ConnectOptions,
	DeviceEvent,
	HidDeviceInfo,
} from "./device-contracts.js";
import {
	QuakeCallbackFailed,
	QuakeConnectionClosed,
	type QuakeHidCloseFailed,
} from "./device-errors.js";
import { type DeviceStreamError, QuakeDevice } from "./device-service.js";
import type { HidTransport } from "./hid-transport.js";
import { NodeHidLive } from "./node-hid.js";

export type DeviceSubscriptionError = DeviceStreamError | QuakeCallbackFailed;

export interface QuakeDeviceClient {
	readonly connect: () => Promise<HidDeviceInfo>;
	readonly subscribe: (
		onEvent: (event: DeviceEvent) => void,
		onError?: (error: DeviceSubscriptionError) => void,
	) => () => void;
	readonly disconnect: () => Promise<void>;
}

interface Session {
	readonly info: HidDeviceInfo;
	readonly disconnect: Effect.Effect<void, QuakeHidCloseFailed>;
}
const Session = Context.GenericTag<Session>("@open-quake/device/PlainSession");

/** A single-use JS client. Construction/subscription never opens native HID. */
export function createQuakeDevice(
	options: ConnectOptions = {},
	transport: Layer.Layer<HidTransport> = NodeHidLive,
): QuakeDeviceClient {
	const listeners = new Set<{
		onEvent: (event: DeviceEvent) => void;
		onError?: (error: DeviceSubscriptionError) => void;
	}>();
	let connecting: Promise<HidDeviceInfo> | undefined;
	let closing: Promise<void> | undefined;
	let closed = false;
	const call = (
		callback: () => void,
	): Effect.Effect<void, QuakeCallbackFailed> =>
		Effect.try({
			try: callback,
			catch: (cause) => new QuakeCallbackFailed(cause),
		});
	const notifyError = (
		callback: ((error: DeviceSubscriptionError) => void) | undefined,
		error: DeviceSubscriptionError,
	): Effect.Effect<void> =>
		callback
			? call(() => callback(error)).pipe(
					Effect.catchTag("QuakeCallbackFailed", () => Effect.void),
				)
			: Effect.void;
	const session = Layer.scoped(
		Session,
		Effect.gen(function* () {
			const device = yield* QuakeDevice;
			const connection = yield* device.connect(options);
			const events = yield* connection.subscribe();
			const notifyListeners = (
				error: DeviceSubscriptionError,
			): Effect.Effect<void> =>
				Effect.forEach(
					[...listeners],
					(listener) => notifyError(listener.onError, error),
					{ discard: true },
				);
			const pump = yield* Stream.runForEach(events, (event) => {
				if (event._tag === "Disconnect") closed = true;
				return Effect.forEach(
					[...listeners],
					(listener) =>
						call(() => listener.onEvent(event)).pipe(
							Effect.catchTag("QuakeCallbackFailed", (error) =>
								notifyError(listener.onError, error),
							),
						),
					{ discard: true },
				);
			}).pipe(
				Effect.catchTags({
					QuakeHidReadFailed: notifyListeners,
					QuakeHidWriteFailed: notifyListeners,
					QuakeHidCloseFailed: notifyListeners,
					QuakeReportInvalid: notifyListeners,
				}),
				Effect.forkScoped,
			);
			return {
				info: connection.info,
				disconnect: connection
					.disconnect()
					.pipe(Effect.ensuring(Fiber.join(pump))),
			};
		}),
	);
	const runtime = ManagedRuntime.make(
		session.pipe(Layer.provide(QuakeDevice.Default), Layer.provide(transport)),
	);
	const run = async <A, E>(
		effect: Effect.Effect<A, E, Session>,
	): Promise<A> => {
		const exit = await runtime.runPromiseExit(effect);
		if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
		return exit.value;
	};
	return {
		connect: () => {
			if (closed) return Promise.reject(new QuakeConnectionClosed());
			connecting ??= run(Effect.map(Session, (session) => session.info));
			return connecting;
		},
		subscribe: (onEvent, onError) => {
			if (closed) return () => {};
			const listener = { onEvent, ...(onError ? { onError } : {}) };
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		disconnect: () => {
			closed = true;
			closing ??= (async () => {
				try {
					if (connecting) {
						await connecting;
						await run(Effect.flatMap(Session, (session) => session.disconnect));
					}
				} finally {
					await runtime.dispose();
					listeners.clear();
				}
			})();
			return closing;
		},
	};
}

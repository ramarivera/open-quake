import {
	decodeQmkResponse,
	encodeQmkCommand,
	type QmkCommand,
	type QmkResponse,
} from "@open-quake/protocol";
import {
	Context,
	Deferred,
	Effect,
	Either,
	Exit,
	Option,
	type Scope,
	Stream,
} from "effect";
import { type HidDeviceInfo, isQuakeDevice } from "../device-contracts.js";
import { HidTransport } from "../hid-transport.js";
import { NodeHidLive } from "../node-hid.js";
import type {
	LightingCapabilities,
	LightingChange,
	LightingFieldCapability,
	LightingTarget,
} from "./lighting-contracts.js";
import {
	LightingIoFailed,
	LightingReadFailed,
	LightingTargetUnavailable,
} from "./lighting-errors.js";
import {
	sameTarget,
	validateCapabilities,
	valueFits,
} from "./lighting-invariants.js";

/** Private infrastructure registration. Serial/session resolution belongs to the
 * live device owner, because HidDeviceInfo does not expose serial identity. */
export interface LightingRegistration {
	readonly info: HidDeviceInfo;
	readonly capabilities: LightingCapabilities;
}
export class LightingTargetRegistry extends Context.Tag(
	"@open-quake/device/LightingTargetRegistry",
)<
	LightingTargetRegistry,
	{
		readonly resolve: (
			target: LightingTarget,
		) => Effect.Effect<
			Option.Option<LightingRegistration>,
			LightingTargetUnavailable
		>;
	}
>() {}

export interface LightingConnection {
	readonly capabilities: LightingCapabilities;
	readonly ended: Effect.Effect<void, LightingIoFailed>;
	readonly exchange: (
		command: QmkCommand,
	) => Effect.Effect<QmkResponse, LightingIoFailed | LightingTargetUnavailable>;
	readonly read: (
		cap: LightingFieldCapability,
	) => Effect.Effect<
		LightingChange,
		LightingReadFailed | LightingTargetUnavailable
	>;
}

export class LightingDevice extends Effect.Service<LightingDevice>()(
	"@open-quake/device/LightingDevice",
	{
		accessors: true,
		dependencies: [NodeHidLive],
		effect: Effect.gen(function* () {
			const registry = yield* LightingTargetRegistry;
			const transport = yield* HidTransport;
			const resolve = Effect.fn("LightingDevice.resolve")(function* (
				target: LightingTarget,
			): Effect.fn.Return<LightingRegistration, LightingTargetUnavailable> {
				const resolved = yield* registry.resolve(target);
				if (Option.isNone(resolved))
					return yield* new LightingTargetUnavailable();
				const capabilities = yield* validateCapabilities(
					target,
					resolved.value.capabilities,
				);
				if (!isQuakeDevice(resolved.value.info))
					return yield* new LightingTargetUnavailable();
				return { info: { ...resolved.value.info }, capabilities };
			});
			const open = Effect.fn("LightingDevice.open")(function* (
				registration: LightingRegistration,
			): Effect.fn.Return<
				LightingConnection,
				LightingTargetUnavailable | LightingReadFailed,
				Scope.Scope
			> {
				const { capabilities: caps, info } = registration;
				const current = Effect.fn("LightingDevice.checkBinding")(
					function* (): Effect.fn.Return<void, LightingTargetUnavailable> {
						const fresh = yield* resolve(caps.target);
						if (
							!sameTarget(fresh.capabilities.target, caps.target) ||
							fresh.info.path !== info.path ||
							JSON.stringify(fresh.capabilities) !== JSON.stringify(caps)
						)
							return yield* new LightingTargetUnavailable();
					},
				);
				yield* current();
				const devices = yield* transport
					.discover()
					.pipe(
						Effect.catchTag("QuakeHidDiscoveryFailed", (cause) =>
							Effect.fail(new LightingTargetUnavailable(cause)),
						),
					);
				if (
					!devices.some(
						(device) => device.path === info.path && isQuakeDevice(device),
					)
				)
					return yield* new LightingTargetUnavailable();
				const lock = yield* Effect.makeSemaphore(1);
				const handle = yield* Effect.acquireRelease(
					transport
						.open(info)
						.pipe(
							Effect.catchTag("QuakeHidOpenFailed", (cause) =>
								Effect.fail(new LightingTargetUnavailable(cause)),
							),
						),
					(handle) =>
						lock.withPermits(1)(
							handle
								.close()
								.pipe(
									Effect.catchTag("QuakeHidCloseFailed", (cause) =>
										Effect.logWarning(cause.code),
									),
								),
						),
				);
				const ended = yield* Deferred.make<void, LightingIoFailed>();
				let pending = Option.none<{
					readonly command: QmkCommand;
					readonly response: Deferred.Deferred<QmkResponse, LightingIoFailed>;
				}>();
				const stop = (cause: LightingIoFailed): Effect.Effect<void> =>
					Effect.gen(function* () {
						yield* Deferred.fail(ended, cause);
						if (Option.isSome(pending))
							yield* Deferred.fail(pending.value.response, cause);
					});
				// Acquire the stream before sending the first command, including sync fakes.
				const pull = yield* Stream.toPull(handle.reports);
				yield* Stream.runForEach(
					Stream.repeatEffectChunkOption(pull),
					(report) => {
						if (Option.isNone(pending)) return Effect.void;
						const response = decodeQmkResponse(pending.value.command, report);
						return Either.isRight(response)
							? Deferred.succeed(pending.value.response, response.right).pipe(
									Effect.asVoid,
								)
							: Effect.void;
					},
				).pipe(
					Effect.matchEffect({
						onFailure: (cause) => stop(new LightingIoFailed(cause)),
						onSuccess: () => stop(new LightingIoFailed("transport-ended")),
					}),
					Effect.forkScoped,
				);
				const exchange = Effect.fn("LightingDevice.exchange")(
					(
						command: QmkCommand,
					): Effect.Effect<
						QmkResponse,
						LightingIoFailed | LightingTargetUnavailable
					> =>
						lock.withPermits(1)(
							Effect.gen(function* () {
								if (Option.isSome(yield* Deferred.poll(ended)))
									return yield* new LightingTargetUnavailable();
								yield* current();
								const encoded = encodeQmkCommand(command);
								if (Either.isLeft(encoded))
									return yield* new LightingIoFailed(encoded.left);
								const response = yield* Deferred.make<
									QmkResponse,
									LightingIoFailed
								>();
								pending = Option.some({ command, response });
								return yield* Effect.gen(function* () {
									yield* handle.write(encoded.right).pipe(
										Effect.catchTag("QuakeHidWriteFailed", (cause) =>
											Effect.fail(new LightingIoFailed(cause)),
										),
										Effect.uninterruptible,
									);
									const result = yield* Deferred.await(response);
									yield* current();
									return result;
								}).pipe(
									Effect.raceFirst(
										Deferred.await(ended).pipe(
											Effect.zipRight(
												Effect.fail(new LightingIoFailed("transport-ended")),
											),
										),
									),
									Effect.timeoutFail({
										duration: 1500,
										onTimeout: () => new LightingIoFailed("response-timeout"),
									}),
									Effect.onExit((exit) => {
										pending = Option.none();
										return Exit.isFailure(exit)
											? stop(new LightingIoFailed(exit.cause))
											: Effect.void;
									}),
								);
							}),
						),
				);
				const read = Effect.fn("LightingDevice.read")(function* (
					cap: LightingFieldCapability,
				): Effect.fn.Return<
					LightingChange,
					LightingReadFailed | LightingTargetUnavailable
				> {
					const response = yield* exchange({
						command: 8,
						lightingValue: cap.valueId,
						resultLength:
							cap.field === "color1" || cap.field === "color2" ? 2 : 1,
					}).pipe(
						Effect.catchTag("LightingIoFailed", (cause) =>
							Effect.fail(new LightingReadFailed(cause)),
						),
					);
					if (response.command !== 8)
						return yield* new LightingReadFailed(response);
					const change: LightingChange =
						cap.field === "color1" || cap.field === "color2"
							? {
									field: cap.field,
									value: {
										hue: response.values[0] ?? -1,
										saturation: response.values[1] ?? -1,
									},
								}
							: { field: cap.field, value: response.values[0] ?? -1 };
					if (!valueFits(cap, change))
						return yield* new LightingReadFailed(response);
					return change;
				});
				const version = yield* exchange({ command: 1 }).pipe(
					Effect.catchTag("LightingIoFailed", (cause) =>
						Effect.fail(new LightingReadFailed(cause)),
					),
				);
				if (
					version.command !== 1 ||
					version.version !== caps.identity.protocolVersion
				)
					return yield* new LightingTargetUnavailable();
				return {
					capabilities: caps,
					ended: Deferred.await(ended),
					exchange,
					read,
				};
			});
			return { resolve, open };
		}),
	},
) {}

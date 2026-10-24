import { Clock, Context, Effect, Fiber, Option, Schema } from "effect";
import {
	FirmwareSnapshot,
	idleFirmware,
	newerVersion,
	runningFirmware,
} from "./contracts.js";
import {
	FirmwareBusy,
	type FirmwarePersistenceFailed,
	FirmwareTargetMismatch,
	FirmwareUnavailable,
	FirmwareVerificationFailed,
	FirmwareVolumeInvalid,
	type FirmwareWriteFailed,
	type MaintenanceError,
} from "./maintenance-errors.js";

export interface FirmwareImage {
	readonly fingerprint: string;
	readonly version: string;
	readonly fileName: string;
	readonly bytes: number;
	readonly trusted: boolean;
}
export interface FirmwareVolume {
	readonly id: string;
	readonly label: string;
}
export class FirmwarePort extends Context.Tag("FirmwarePort")<
	FirmwarePort,
	{
		current: () => Effect.Effect<
			{
				readonly serial: string;
				readonly version: string;
				readonly session: string;
			},
			FirmwareUnavailable
		>;
		version: (serial: string) => Effect.Effect<string, FirmwareUnavailable>;
		image: () => Effect.Effect<FirmwareImage, FirmwareTargetMismatch>;
		enter: (
			serial: string,
			session: string,
		) => Effect.Effect<void, FirmwareUnavailable>;
		volumes: () => Effect.Effect<
			readonly FirmwareVolume[],
			FirmwareVolumeInvalid
		>;
		copy: (
			image: FirmwareImage,
			volume: FirmwareVolume,
			progress: (bytes: number) => void,
		) => Effect.Effect<
			void,
			FirmwareWriteFailed | FirmwareVolumeInvalid | FirmwareTargetMismatch
		>;
		load: () => Effect.Effect<unknown, FirmwarePersistenceFailed>;
		save: (
			snapshot: FirmwareSnapshot,
		) => Effect.Effect<void, FirmwarePersistenceFailed>;
	}
>() {}
export const firmwareTiming = {
	wait: 90000,
	poll: 500,
	settle: 2500,
	verify: 90000,
	versionPoll: 2000,
	versionTimeout: 3000,
	ttl: 600000,
} as const;

export class FirmwareUpdates extends Effect.Service<FirmwareUpdates>()(
	"FirmwareUpdates",
	{
		scoped: Effect.gen(function* () {
			const port = yield* FirmwarePort;
			const scope = yield* Effect.scope;
			const lock = yield* Effect.makeSemaphore(1);
			let state = idleFirmware;
			let worker = Option.none<Fiber.RuntimeFiber<void, never>>();
			let selectedImage: FirmwareImage | undefined;
			const loaded = yield* port.load();
			if (Schema.is(FirmwareSnapshot)(loaded))
				state = runningFirmware(loaded)
					? {
							...loaded,
							state: "needs_recovery",
							reason: "interrupted",
							endedAt: yield* Clock.currentTimeMillis,
						}
					: loaded;
			const set = (
				next: Partial<FirmwareSnapshot>,
			): Effect.Effect<void, FirmwarePersistenceFailed> =>
				Effect.gen(function* () {
					state = { ...state, ...next };
					yield* port.save(state);
				});
			const failed = (error: MaintenanceError): Effect.Effect<void> =>
				Effect.gen(function* () {
					const recovery = [
						"copying",
						"written_unverified",
						"verifying",
					].includes(state.state);
					state = {
						...state,
						state: recovery ? "needs_recovery" : "failed",
						reason: state.reason || error.code,
						endedAt: yield* Clock.currentTimeMillis,
					};
					yield* port
						.save(state)
						.pipe(
							Effect.catchTag("FirmwarePersistenceFailed", () => Effect.void),
						);
				});
			const discover = Effect.gen(function* () {
				const begin = yield* Clock.currentTimeMillis;
				while ((yield* Clock.currentTimeMillis) - begin < firmwareTiming.wait) {
					const volumes = yield* port.volumes();
					if (volumes.length) {
						yield* set({ state: "ready_to_write", volumes });
						return;
					}
					yield* Effect.sleep(firmwareTiming.poll);
				}
				yield* set({ reason: "dfu_volume_timeout" });
				return yield* new FirmwareVolumeInvalid();
			});
			const run = (
				effect: Effect.Effect<void, MaintenanceError>,
			): Effect.Effect<void> =>
				effect.pipe(
					Effect.matchEffect({
						onFailure: failed,
						onSuccess: () => Effect.void,
					}),
				);
			const start = Effect.fn("FirmwareUpdates.start")(function* (expected?: {
				readonly serial: string;
				readonly session: string;
			}): Effect.fn.Return<void, MaintenanceError> {
				yield* lock.withPermits(1)(
					Effect.gen(function* () {
						if (runningFirmware(state)) return yield* new FirmwareBusy();
						const image = yield* port.image();
						const device = yield* port.current();
						if (
							expected &&
							(device.serial !== expected.serial ||
								device.session !== expected.session)
						)
							return yield* new FirmwareUnavailable();
						if (!image.trusted || !newerVersion(image.version, device.version))
							return yield* new FirmwareTargetMismatch();
						selectedImage = image;
						yield* set({
							...idleFirmware,
							state: "checking",
							serial: device.serial,
							from: device.version,
							to: image.version,
							fileName: image.fileName,
							fingerprint: image.fingerprint,
							total: image.bytes,
						});
						worker = Option.some(
							yield* run(
								Effect.gen(function* () {
									yield* set({ state: "entering_download_mode", step: 0 });
									yield* port.enter(device.serial, device.session);
									yield* set({ state: "waiting_volume", step: 1 });
									yield* discover;
								}),
							).pipe(Effect.forkIn(scope)),
						);
					}),
				);
			});
			const write = Effect.fn("FirmwareUpdates.write")(function* (
				id: string,
			): Effect.fn.Return<void, MaintenanceError> {
				yield* lock.withPermits(1)(
					Effect.gen(function* () {
						if (state.state !== "ready_to_write" || !selectedImage)
							return yield* new FirmwareBusy();
						const volume = state.volumes.find((v) => v.id === id);
						if (!volume) return yield* new FirmwareVolumeInvalid();
						const image = selectedImage;
						yield* set({ state: "copying", step: 2 });
						worker = Option.some(
							yield* run(
								Effect.gen(function* () {
									yield* Effect.sleep(firmwareTiming.settle);
									// Adapter revalidates the mount and the original bytes, not renderer metadata.
									yield* port.copy(image, volume, (copied) => {
										state = { ...state, copied };
									});
									yield* set({
										state: "written_unverified",
										copied: image.bytes,
									});
									yield* set({ state: "verifying", step: 3 });
									const begin = yield* Clock.currentTimeMillis;
									while (
										(yield* Clock.currentTimeMillis) - begin <
										firmwareTiming.verify
									) {
										const version = yield* port.version(state.serial).pipe(
											Effect.timeoutOption(firmwareTiming.versionTimeout),
											Effect.catchTag("FirmwareUnavailable", () =>
												Effect.succeed(Option.none<string>()),
											),
										);
										if (Option.isSome(version)) {
											if (version.value !== image.version) {
												yield* set({ reason: "version_mismatch" });
												return yield* new FirmwareVerificationFailed();
											}
											yield* set({
												state: "success",
												reason: "",
												endedAt: yield* Clock.currentTimeMillis,
											});
											return;
										}
										yield* Effect.sleep(firmwareTiming.versionPoll);
									}
									yield* set({ reason: "verify_timeout" });
									return yield* new FirmwareVerificationFailed();
								}),
							).pipe(Effect.forkIn(scope)),
						);
					}),
				);
			});
			return {
				start,
				write,
				snapshot: Effect.fn("FirmwareUpdates.snapshot")(
					function* (): Effect.fn.Return<FirmwareSnapshot> {
						if (
							state.endedAt &&
							(yield* Clock.currentTimeMillis) - state.endedAt >=
								firmwareTiming.ttl
						)
							state = idleFirmware;
						return state;
					},
				),
				cancel: Effect.fn("FirmwareUpdates.cancel")(
					function* (): Effect.fn.Return<void, MaintenanceError> {
						yield* lock.withPermits(1)(
							Effect.gen(function* () {
								if (state.state !== "ready_to_write")
									return yield* new FirmwareBusy();
								if (Option.isSome(worker)) yield* Fiber.interrupt(worker.value);
								yield* set({
									state: "needs_recovery",
									reason: "cancelled_before_write",
									endedAt: yield* Clock.currentTimeMillis,
								});
							}),
						);
					},
				),
				close: Effect.fn("FirmwareUpdates.close")(
					function* (): Effect.fn.Return<void, FirmwarePersistenceFailed> {
						if (!runningFirmware(state)) yield* set({ ...idleFirmware });
					},
				),
			};
		}),
	},
) {}

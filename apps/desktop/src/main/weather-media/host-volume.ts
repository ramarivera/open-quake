import { Clock, Effect, Schema } from "effect";
import type { KnobError } from "../../../../../packages/device/src/knob/knob-errors";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors";
import { VolumeReading } from "../../../../../packages/device/src/knob/model/contracts";
import { nativeHostVolume } from "./native/volume";

export interface HostVolumePort {
	readonly read: Effect.Effect<VolumeReading, KnobError>;
	readonly write: (reading: VolumeReading) => Effect.Effect<void, KnobError>;
}

/** One read/write gate and one observer, shared by keys and the armed knob. */
export const makeHostVolume = Effect.fn("HostVolume.make")(function* (
	port: HostVolumePort,
) {
	const lock = yield* Effect.makeSemaphore(1);
	let value: VolumeReading | undefined;
	let sampled = -Infinity;
	const listeners = new Set<(reading: VolumeReading) => void>();
	const publish = (reading: VolumeReading) =>
		Effect.sync(() => {
			value = reading;
			for (const listener of listeners) listener(reading);
		});
	const sample = Effect.gen(function* () {
		const reading = yield* port.read;
		if (!Schema.is(VolumeReading)(reading))
			return yield* KnobDispatchFailed.fromCause(
				new RangeError("Invalid volume reading"),
			);
		sampled = yield* Clock.currentTimeMillis;
		yield* publish(reading);
		return reading;
	});
	const read = Effect.fn("HostVolume.read")(function* () {
		const now = yield* Clock.currentTimeMillis;
		return value && now - sampled < 2000 ? value : yield* sample;
	});
	const write = Effect.fn("HostVolume.write")((reading: VolumeReading) =>
		lock.withPermits(1)(
			Effect.gen(function* () {
				const next = yield* Schema.decodeUnknown(VolumeReading)(reading).pipe(
					Effect.mapError(KnobDispatchFailed.fromCause),
				);
				const before = yield* read();
				if (before.level === next.level && before.muted === next.muted) return;
				yield* port.write(next);
				yield* sample;
			}),
		),
	);
	const command = Effect.fn("HostVolume.command")(
		(command: "audio_mute" | "audio_vol_down" | "audio_vol_up") =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					// A command checks fresh native state so an external mute never inverts a cache.
					const before = yield* sample;
					const level =
						command === "audio_mute"
							? before.level
							: Math.max(
									0,
									Math.min(
										100,
										before.level + (command === "audio_vol_up" ? 1 : -1),
									),
								);
					const next = {
						level,
						muted: command === "audio_mute" ? !before.muted : level === 0,
					};
					if (next.level !== before.level || next.muted !== before.muted)
						yield* port.write(next);
					return yield* sample;
				}),
			),
	);
	yield* Effect.forkScoped(
		Effect.forever(
			Effect.sleep(2000).pipe(
				Effect.zipRight(
					Effect.suspend(() =>
						listeners.size
							? lock
									.withPermits(1)(sample)
									.pipe(
										Effect.asVoid,
										Effect.catchAll((error) => Effect.logWarning(error)),
									)
							: Effect.void,
					),
				),
			),
		),
	);
	yield* Effect.addFinalizer(() => Effect.sync(() => listeners.clear()));
	return {
		read: lock.withPermits(1)(read()),
		write,
		command,
		observe: (listener: (reading: VolumeReading) => void) => {
			listeners.add(listener);
			if (value) listener(value);
			return () => {
				listeners.delete(listener);
			};
		},
	};
});

export class HostVolume extends Effect.Service<HostVolume>()("HostVolume", {
	accessors: true,
	scoped: makeHostVolume(
		nativeHostVolume(
			process.platform,
			process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
		),
	),
}) {}

export const hostVolumeLive = HostVolume.Default;

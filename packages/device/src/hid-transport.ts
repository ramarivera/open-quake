import { Context, type Effect, type Stream } from "effect";
import type { HidDeviceInfo } from "./device-contracts.js";
import type {
	QuakeHidCloseFailed,
	QuakeHidDiscoveryFailed,
	QuakeHidOpenFailed,
	QuakeHidReadFailed,
	QuakeHidWriteFailed,
} from "./device-errors.js";

export interface HidConnection {
	readonly reports: Stream.Stream<Uint8Array, QuakeHidReadFailed>;
	/** Exactly 33 bytes, including the leading report ID 0x00. */
	readonly write: (
		report: Uint8Array,
	) => Effect.Effect<void, QuakeHidWriteFailed>;
	readonly close: () => Effect.Effect<void, QuakeHidCloseFailed>;
}

/** Infrastructure interface. QuakeDevice owns each opened handle's lifetime. */
export class HidTransport extends Context.Tag(
	"@open-quake/device/HidTransport",
)<
	HidTransport,
	{
		readonly discover: () => Effect.Effect<
			ReadonlyArray<HidDeviceInfo>,
			QuakeHidDiscoveryFailed
		>;
		readonly open: (
			device: HidDeviceInfo,
		) => Effect.Effect<HidConnection, QuakeHidOpenFailed>;
	}
>() {}

import { Effect } from "effect";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import { QuakeHidOpenFailed } from "../../../../../../packages/device/src/device-errors.js";
import type { HidTransport } from "../../../../../../packages/device/src/hid-transport.js";

/** Recheck every connect/reconnect discovery before opening or writing. */
export function exactDeviceTransport(
	source: HidTransport["Type"],
	serial: string,
): HidTransport["Type"] {
	return {
		...source,
		open: (info) =>
			canonicalHidSerial(info.serialNumber ?? "") === serial
				? source.open(info)
				: Effect.fail(new QuakeHidOpenFailed(undefined)),
	};
}

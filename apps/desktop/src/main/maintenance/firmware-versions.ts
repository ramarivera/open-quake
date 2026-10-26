import { newerVersion } from "../../../../../packages/edge/src/maintenance/contracts.js";
import type { FirmwareImage } from "../../../../../packages/edge/src/maintenance/firmware-service.js";
/** A version belongs to a serial, never to whichever device happens to be present. */
export function firmwareVersions() {
	const known = new Map<string, string>();
	const fresh = new Map<string, string>();
	let lastSerial = "";
	return {
		readback: (serial: string, version: string) => {
			if (version) {
				known.set(serial, version);
				fresh.set(serial, version);
			}
		},
		observe: (
			serial: string,
			reported: string,
			image: FirmwareImage | undefined,
		) => {
			if (serial) lastSerial = serial;
			if (serial && reported && !fresh.has(serial)) known.set(serial, reported);
			const currentVersion = known.get(serial || lastSerial) ?? "";
			const firmwareAvailability = !serial
				? ("no_device" as const)
				: !image?.trusted
					? ("no_bundled_firmware" as const)
					: !currentVersion
						? ("device_version_unknown" as const)
						: newerVersion(image.version, currentVersion)
							? ("newer_bundled" as const)
							: ("up_to_date" as const);
			return { serial, currentVersion, firmwareAvailability };
		},
	};
}

import { canonicalHidSerial } from "@open-quake/device";
import { isQuakeInterface } from "@open-quake/protocol";

export interface ViaDevice {
	readonly deviceId: string;
	readonly vendorId: number;
	readonly productId: number;
	readonly serialNumber?: string;
	readonly collections?: readonly { usagePage: number; usage: number }[];
}
export function viaOriginMatches(origin: string, configured: string): boolean {
	try {
		const expected = new URL(configured),
			actual = new URL(origin);
		return (
			expected.protocol === "http:" &&
			["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname) &&
			!!expected.port &&
			expected.origin === actual.origin &&
			actual.username === "" &&
			actual.password === ""
		);
	} catch {
		return false;
	}
}
export function selectViaDevice(
	origin: string,
	configured: string,
	serial: string,
	devices: readonly ViaDevice[],
): ViaDevice | undefined {
	const canonical = canonicalHidSerial(serial);
	if (!viaOriginMatches(origin, configured) || !canonical) return;
	const candidates = devices.filter(
		(d) =>
			!!d.serialNumber &&
			canonicalHidSerial(d.serialNumber) === canonical &&
			d.collections?.some((c) =>
				isQuakeInterface({
					...c,
					vendorId: d.vendorId,
					productId: d.productId,
				}),
			),
	);
	return candidates.length === 1 ? candidates[0] : undefined;
}
/** Handoff is mandatory and awaited before Chromium receives the selected id. */
export function viaPermissionBroker(options: {
	origin: string;
	selectedSerial: () => string | undefined;
	release: (serial: string) => Promise<(() => Promise<void>) | undefined>;
}) {
	let lease:
		| { serial: string; deviceId: string; resume: () => Promise<void> }
		| undefined;
	let pending: Promise<string> | undefined;
	let pendingId: string | undefined;
	let generation = 0;
	let closed = false;
	const resume = async () => {
		generation++;
		const old = lease;
		lease = undefined;
		await old?.resume();
		await pending;
	};
	return {
		select: (
			origin: string,
			devices: readonly ViaDevice[],
		): Promise<string> => {
			if (closed || lease || pending) return Promise.resolve("");
			const serial = options.selectedSerial();
			const selected =
				serial && selectViaDevice(origin, options.origin, serial, devices);
			if (!selected || !serial) return Promise.resolve("");
			const reserved = generation;
			pendingId = selected.deviceId;
			pending = (async () => {
				try {
					const release = await options.release(serial);
					if (!release) return "";
					if (
						closed ||
						reserved !== generation ||
						serial !== options.selectedSerial()
					) {
						await release();
						return "";
					}
					lease = { serial, deviceId: selected.deviceId, resume: release };
					return selected.deviceId;
				} catch {
					return "";
				}
			})().finally(() => {
				pending = undefined;
				pendingId = undefined;
			});
			return pending;
		},
		permitted: (origin: string, device: ViaDevice): boolean =>
			!closed &&
			!!lease &&
			lease.serial === options.selectedSerial() &&
			lease.deviceId === device.deviceId &&
			!!selectViaDevice(origin, options.origin, lease.serial, [device]),
		removed: async (device: ViaDevice) => {
			if (device.deviceId === lease?.deviceId || device.deviceId === pendingId)
				await resume();
		},
		resume,
		dispose: async () => {
			closed = true;
			await resume();
		},
	};
}

export function registerViaPermissions(
	session: Electron.Session,
	options: Parameters<typeof viaPermissionBroker>[0],
): () => Promise<void> {
	const broker = viaPermissionBroker(options);
	const select = (
		event: Electron.Event,
		details: Electron.SelectHidDeviceDetails,
		callback: (id: string) => void,
	) => {
		event.preventDefault();
		void broker
			.select(details.frame?.url ?? "", details.deviceList)
			.then(callback, () => callback(""));
	};
	session.on("select-hid-device", select);
	session.setDevicePermissionHandler(
		(details) =>
			details.deviceType === "hid" &&
			"deviceId" in details.device &&
			broker.permitted(details.origin, details.device),
	);
	const removed = (
		_event: Electron.Event,
		details: Electron.HidDeviceRemovedDetails,
	) => {
		void broker.removed(details.device);
	};
	session.on("hid-device-removed", removed);
	return async () => {
		session.removeListener("select-hid-device", select);
		session.removeListener("hid-device-removed", removed);
		session.setDevicePermissionHandler(null);
		await broker.dispose();
	};
}

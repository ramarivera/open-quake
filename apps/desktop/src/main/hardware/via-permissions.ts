import { canonicalHidSerial } from "@open-quake/device";
import { isQuakeInterface } from "@open-quake/protocol";
import { webContents } from "electron";

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
	options: Parameters<typeof viaPermissionBroker>[0] & {
		isPresent: (serial: string) => Promise<boolean>;
	},
): () => Promise<void> {
	const broker = viaPermissionBroker(options);
	let closed = false;
	let owner:
		| {
				frame: Electron.WebFrameMain;
				deviceId: string;
				url: string;
				serial: string;
				contents: Electron.WebContents;
		  }
		| undefined;
	const ownerValid = () =>
		!!owner &&
		!owner.frame.isDestroyed() &&
		!owner.frame.detached &&
		owner.frame.url === owner.url &&
		!owner.contents.isDestroyed();
	const releaseOwner = async () => {
		const old = owner;
		owner = undefined;
		old?.contents.removeListener("did-start-navigation", navigating);
		old?.contents.removeListener("destroyed", releaseOwner);
		old?.contents.removeListener("render-process-gone", releaseOwner);
		await broker.resume();
	};
	const navigating = (
		event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
	) => {
		if (event.isSameDocument) return;
		if (owner && (event.isMainFrame || event.frame === owner.frame))
			void releaseOwner();
	};
	// Electron 43 hid-device-removed is chooser-only. Enumerate without opening a handle
	// for established unplug, and check subframe teardown even without navigation events.
	let checking = false;
	const timer = setInterval(() => {
		if (!owner || checking) return;
		const current = owner;
		if (!ownerValid()) {
			void releaseOwner();
			return;
		}
		checking = true;
		void options
			.isPresent(current.serial)
			.then((present) => {
				if (!present && owner === current) return releaseOwner();
			})
			.catch(() => {
				if (owner === current) return releaseOwner();
			})
			.finally(() => {
				checking = false;
			});
	}, 500);
	timer.unref();
	const select = (
		event: Electron.Event,
		details: Electron.SelectHidDeviceDetails,
		callback: (id: string) => void,
	) => {
		event.preventDefault();
		const frame = details.frame;
		const contents = frame && webContents.fromFrame(frame);
		const serial = options.selectedSerial();
		if (
			closed ||
			owner ||
			!frame ||
			!contents ||
			!serial ||
			frame.isDestroyed() ||
			frame.detached ||
			!selectViaDevice(frame.url, options.origin, serial, details.deviceList)
		) {
			callback("");
			return;
		}
		const selectedOwner = {
			frame,
			contents,
			serial,
			url: frame.url,
			deviceId:
				selectViaDevice(frame.url, options.origin, serial, details.deviceList)
					?.deviceId ?? "",
		};
		owner = selectedOwner;
		contents.on("did-start-navigation", navigating);
		contents.on("destroyed", releaseOwner);
		contents.on("render-process-gone", releaseOwner);
		void broker.select(frame.url, details.deviceList).then(
			async (id) => {
				if (!id || owner !== selectedOwner || !ownerValid()) {
					if (owner === selectedOwner) await releaseOwner();
					callback("");
				} else callback(id);
			},
			async () => {
				if (owner === selectedOwner) await releaseOwner();
				callback("");
			},
		);
	};
	session.on("select-hid-device", select);
	session.setDevicePermissionHandler(
		(details) =>
			ownerValid() &&
			details.deviceType === "hid" &&
			"deviceId" in details.device &&
			broker.permitted(details.origin, details.device),
	);
	const removed = (
		_event: Electron.Event,
		details: Electron.HidDeviceRemovedDetails,
	) => {
		if (owner?.deviceId === details.device.deviceId) void releaseOwner();
		else void broker.removed(details.device);
	};
	session.on("hid-device-removed", removed);
	const revoked = (
		_event: Electron.Event,
		details: Electron.HidDeviceRevokedDetails,
	) => {
		if (
			(!details.origin || viaOriginMatches(details.origin, options.origin)) &&
			owner?.deviceId === details.device.deviceId
		)
			void releaseOwner();
	};
	session.on("hid-device-revoked", revoked);
	return async () => {
		closed = true;
		clearInterval(timer);
		await releaseOwner();
		session.removeListener("hid-device-revoked", revoked);
		session.removeListener("select-hid-device", select);
		session.removeListener("hid-device-removed", removed);
		session.setDevicePermissionHandler(null);
		await broker.dispose();
	};
}

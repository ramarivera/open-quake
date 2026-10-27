import { isQuakeInterface } from "@open-quake/protocol";

export interface ViaDevice {
    readonly deviceId: string;
    readonly vendorId: number;
    readonly productId: number;
    readonly serialNumber?: string;
    readonly collections?: readonly {usagePage: number; usage: number}[];
}
export function viaOriginMatches(origin: string, configured: string): boolean {
    try {
        const expected = new URL(configured), actual = new URL(origin);
        return expected.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname) && !!expected.port && expected.origin === actual.origin && actual.username === "" && actual.password === "";
    } catch { return false; }
}
export function selectViaDevice(origin: string, configured: string, serial: string, devices: readonly ViaDevice[]): ViaDevice | undefined {
    if (!viaOriginMatches(origin, configured) || !serial) return;
    const candidates = devices.filter((d) => d.serialNumber === serial && d.collections?.some((c) => isQuakeInterface({...c, vendorId: d.vendorId, productId: d.productId})));
    return candidates.length === 1 ? candidates[0] : undefined;
}
/** Handoff is mandatory and awaited before Chromium receives the selected id. */
export function viaPermissionBroker(options: {origin: string; selectedSerial: () => string | undefined; release: (serial: string) => Promise<(() => Promise<void>) | undefined>}) {
    let lease: {serial: string; deviceId: string; resume: () => Promise<void>} | undefined;
    return {
        select: async (origin: string, devices: readonly ViaDevice[]): Promise<string> => {
            if (lease) return "";
            const serial = options.selectedSerial();
            const selected = serial && selectViaDevice(origin, options.origin, serial, devices);
            if (!selected || !serial) return "";
            // Reserve before awaiting, so concurrent permission prompts cannot take the same handle.
            lease = {serial, deviceId: selected.deviceId, resume: async () => {}};
            try {
                const resume = await options.release(serial);
                if (!resume) { lease = undefined; return ""; }
                lease = {serial, deviceId: selected.deviceId, resume};
                return selected.deviceId;
            } catch { lease = undefined; return ""; }
        },
        permitted: (origin: string, device: ViaDevice): boolean => !!lease && lease.serial === options.selectedSerial() && lease.deviceId === device.deviceId && !!selectViaDevice(origin, options.origin, lease.serial, [device]),
        resume: async () => { const old = lease; lease = undefined; await old?.resume(); },
    };
}


export function registerViaPermissions(session: Electron.Session, options: Parameters<typeof viaPermissionBroker>[0]): () => Promise<void> {
    const broker = viaPermissionBroker(options);
    const select = (event: Electron.Event, details: Electron.SelectHidDeviceDetails, callback: (id: string) => void) => {
        event.preventDefault();
        void broker.select(details.frame?.url ?? "", details.deviceList).then(callback, () => callback(""));
    };
    session.on("select-hid-device", select);
    session.setDevicePermissionHandler((details) => details.deviceType === "hid" && "deviceId" in details.device && broker.permitted(details.origin, details.device));
    const removed = () => { void broker.resume(); };
    session.on("hid-device-removed", removed);
    return async () => { session.removeListener("select-hid-device", select); session.removeListener("hid-device-removed", removed); session.setDevicePermissionHandler(null); await broker.resume(); };
}

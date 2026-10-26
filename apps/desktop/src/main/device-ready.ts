import { type HardwareSession, HardwareUnavailable } from "@open-quake/device";
import { Effect } from "effect";
import { ipcMain } from "electron";
import {
	DEVICE_READY,
	type DeviceReadyReply,
	type DeviceReadySnapshot,
} from "../shared/hardware-contracts";
import type { DeviceBus } from "./deviceBus";

export function createDeviceReadyReader(options: {
	readonly bus: (serial: string) => DeviceBus | undefined;
	readonly rotation: (serial: string) => number | undefined;
	readonly mock: boolean;
}) {
	const syncing = new WeakMap<HardwareSession, Promise<string | undefined>>();
	return async (serial: string): Promise<DeviceReadyReply> => {
		const bus = options.bus(serial);
		if (bus?.currentStatus()?.state !== "connected") return { _tag: "offline" };
		const hardware = bus.hardware?.();
		if (!hardware) return { _tag: "offline" };
		let refresh = syncing.get(hardware);
		if (!refresh) {
			refresh = Effect.runPromise(
				hardware
					.refresh()
					.pipe(
						Effect.match({
							onSuccess: () => undefined,
							onFailure: (error) => error.code,
						}),
					),
			);
			syncing.set(hardware, refresh);
		}
		try {
			const failure = await refresh;
			if (failure) return { _tag: "failure", code: failure };
		} catch (cause) {
			return { _tag: "failure", code: new HardwareUnavailable(cause).code };
		} finally {
			if (syncing.get(hardware) === refresh) syncing.delete(hardware);
		}
		if (
			options.bus(serial) !== bus ||
			bus.hardware?.() !== hardware ||
			bus.currentStatus()?.state !== "connected"
		)
			return { _tag: "offline" };
		const state = await Effect.runPromise(hardware.snapshot());
		if (!state.available || state.serial !== serial) return { _tag: "offline" };
		const rotation = options.rotation(serial);
		const snapshot: DeviceReadySnapshot = {
			serialNumber: serial,
			connected: true,
			deviceModel: "QUAKE_HID",
			connectionType: options.mock ? "mock" : "HID",
			session: state.session,
			...(state.firmware
				? {
						version: `${state.firmware.major}.${state.firmware.minor}.${state.firmware.patch}`,
					}
				: {}),
			...(rotation === 0 ||
			rotation === 90 ||
			rotation === 180 ||
			rotation === 270
				? { rotation }
				: {}),
			keyMatrix: bus.matrix?.() ?? { row: 2, col: 8 },
		};
		// A disconnect can occur while the snapshot effect is scheduled.
		return options.bus(serial) === bus &&
			bus.hardware?.() === hardware &&
			bus.currentStatus()?.state === "connected"
			? { _tag: "ready", snapshot }
			: { _tag: "offline" };
	};
}
export function registerDeviceReady(
	options: Parameters<typeof createDeviceReadyReader>[0] & {
		readonly panelSerial: (sender: Electron.WebContents) => string | undefined;
		readonly management: () => Electron.WebContents;
	},
) {
	const read = createDeviceReadyReader(options);
	ipcMain.handle(DEVICE_READY, (event, input: unknown) => {
		if (event.senderFrame !== event.sender.mainFrame)
			return { _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" };
		const serial = options.panelSerial(event.sender);
		if (serial) return read(serial);
		if (
			event.sender === options.management() &&
			typeof input === "string" &&
			input.length > 0
		)
			return read(input);
		return { _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" };
	});
	return () => ipcMain.removeHandler(DEVICE_READY);
}

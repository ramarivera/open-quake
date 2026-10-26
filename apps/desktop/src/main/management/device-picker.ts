import { Schema } from "effect";
import { ipcMain } from "electron";
import {
	DeviceChoiceRequest,
	DeviceChoices,
	MANAGEMENT_DEVICES,
} from "../../shared/management";
import { isAppRenderer } from "../profiles/profile-ipc";
import type { ShellWindow } from "./desktop-shell";

export function registerDevicePicker(options: {
	readonly management: () => ShellWindow;
	readonly renderer: string;
	readonly read: () => Promise<typeof DeviceChoices.Type>;
	readonly select: (serial: string, session: string) => Promise<boolean>;
}) {
	let disposed = false;
	const allowed = (event: Electron.IpcMainInvokeEvent) => {
		const win = options.management();
		return (
			!disposed &&
			!win.isDestroyed() &&
			event.sender === win.webContents &&
			event.senderFrame === win.webContents.mainFrame &&
			isAppRenderer(event.senderFrame?.url ?? "", options.renderer)
		);
	};
	ipcMain.handle(MANAGEMENT_DEVICES, async (event, input: unknown) => {
		const decoded = Schema.decodeUnknownOption(DeviceChoiceRequest, {
			onExcessProperty: "error",
		})(input);
		if (!allowed(event) || decoded._tag === "None") return null;
		const frame = event.senderFrame;
		const request = decoded.value;
		if (request.action === "select") {
			const choices = await options.read();
			if (
				!allowed(event) ||
				event.senderFrame !== frame ||
				!choices.devices.some(
					(device) =>
						device.serial === request.device.serial &&
						device.session === request.device.session,
				)
			)
				return null;
			if (
				!(await options.select(request.device.serial, request.device.session))
			)
				return null;
		}
		const result = await options.read();
		if (!allowed(event) || event.senderFrame !== frame) return null;
		return Schema.encodeSync(DeviceChoices)(result);
	});
	return () => {
		disposed = true;
		ipcMain.removeHandler(MANAGEMENT_DEVICES);
	};
}

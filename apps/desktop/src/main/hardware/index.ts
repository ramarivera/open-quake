import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HardwareSession } from "@open-quake/device";
import { Effect } from "effect";
import { ipcMain, powerMonitor } from "electron";
import { HARDWARE_REQUEST } from "../../shared/hardware-contracts";
import { canRequestWallpaper } from "../media/media-permissions";
import { hardwareRequest } from "./controller";

export function registerHardware(
	current: () => HardwareSession | undefined,
	managementWindow: () => { readonly webContents: object } | undefined,
	mock: boolean,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
): () => void {
	ipcMain.handle(HARDWARE_REQUEST, (event, input: unknown) => {
		if (
			event.sender !== managementWindow()?.webContents ||
			event.senderFrame !== event.sender.mainFrame ||
			!canRequestWallpaper(event.sender.getURL(), renderer, input, true)
		)
			return { _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" };
		return Effect.runPromise(hardwareRequest(input, current(), mock));
	});
	const setLocked = (locked: boolean): void => {
		const session = current();
		if (session)
			void Effect.runPromise(
				session.setLocked(locked).pipe(
					Effect.matchEffect({
						onSuccess: () => Effect.void,
						onFailure: (error) => Effect.logWarning(error.code),
					}),
				),
			);
	};
	const lock = () => setLocked(true);
	const unlock = () => setLocked(false);
	powerMonitor.on("lock-screen", lock);
	powerMonitor.on("unlock-screen", unlock);
	return () => {
		ipcMain.removeHandler(HARDWARE_REQUEST);
		powerMonitor.removeListener("lock-screen", lock);
		powerMonitor.removeListener("unlock-screen", unlock);
	};
}

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HardwareSession } from "@open-quake/device";
import { Effect } from "effect";
import { ipcMain, powerMonitor } from "electron";
import { HARDWARE_REQUEST } from "../../shared/hardware-contracts";
import type { DesktopDiagnostics } from "../diagnostics";
import { canRequestWallpaper } from "../media/media-permissions";
import { hardwareRequest } from "./controller";

export function registerHardware(
	current: () => HardwareSession | undefined,
	managementWindow: () => { readonly webContents: object } | undefined,
	mock: boolean,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	diagnostics?: DesktopDiagnostics,
	sessions: () => readonly HardwareSession[] = () => {
		const session = current();
		return session ? [session] : [];
	},
): () => void {
	const observe = <A, E>(work: Effect.Effect<A, E>) =>
		diagnostics
			? diagnostics
					.instrument(work, "voice.device")
					.pipe(Effect.provide(diagnostics.layer))
			: work;
	ipcMain.handle(HARDWARE_REQUEST, (event, input: unknown) => {
		if (
			event.sender !== managementWindow()?.webContents ||
			event.senderFrame !== event.sender.mainFrame ||
			!canRequestWallpaper(event.sender.getURL(), renderer, input, true)
		)
			return { _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" };
		return Effect.runPromise(observe(hardwareRequest(input, current(), mock)));
	});
	const setLocked = (locked: boolean): void => {
		for (const session of sessions())
			void Effect.runPromise(
				observe(session.setLocked(locked)).pipe(
					Effect.matchEffect({
						onSuccess: () => Effect.void,
						onFailure: (error) => observe(Effect.logWarning(error)),
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

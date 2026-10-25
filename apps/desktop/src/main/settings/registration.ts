import { Effect, Layer } from "effect";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { LocaleSnapshot } from "../../../../../packages/edge/src/settings/settings-contracts";
import { SettingsService } from "../../../../../packages/edge/src/settings/settings-service";
import { LOCALE_CHANGED, LOCALE_REQUEST } from "../../shared/locale";
import { agentRequestAllowed } from "../agents/controller";
import type { DesktopDiagnostics } from "../diagnostics";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import { decodeLocaleRequest, handleLocaleRequest } from "./rpc";
import { desktopSettingsStorage } from "./storage";

export function registerAppLocale(options: {
	readonly directory: string;
	readonly osLocale: string;
	readonly renderer: string;
	readonly windows: () => readonly (BrowserWindow | undefined)[];
	readonly diagnostics?: DesktopDiagnostics;
}) {
	const runtime = makeDesktopRuntime(
		SettingsService.Default.pipe(
			Layer.provide(
				desktopSettingsStorage(options.directory, options.osLocale),
			),
		),
		options.diagnostics,
	);
	let disposed = false,
		pending = 0;
	const tasks = new Set<Promise<unknown>>();
	const localeListeners = new Set<(snapshot: LocaleSnapshot) => void>();
	const allowed = (event: IpcMainInvokeEvent) =>
		!disposed &&
		options.windows().some(
			(win) =>
				win &&
				!win.isDestroyed() &&
				agentRequestAllowed(
					{
						senderId: event.sender.id,
						frameURL: event.senderFrame?.url ?? "",
						mainFrame: event.sender.mainFrame === event.senderFrame,
					},
					win.webContents.id,
					options.renderer,
				),
		);
	ipcMain.handle(LOCALE_REQUEST, async (event, input: unknown) => {
		const message = decodeLocaleRequest(input);
		if (!allowed(event) || !message || pending >= 16)
			throw new Error("QUAKE.SETTINGS.UNAUTHORIZED");
		const frame = event.senderFrame;
		pending++;
		const task = runtime.runPromise(
			Effect.gen(function* () {
				const response = yield* handleLocaleRequest(message);
				if (
					!disposed &&
					message._tag === "Request" &&
					message.tag === "settings.setLocale"
				) {
					const snapshot = yield* Effect.flatMap(SettingsService, (service) =>
						service.locale(),
					);
					for (const listener of localeListeners) listener(snapshot);
					for (const win of options.windows()) {
						if (
							win &&
							!win.isDestroyed() &&
							agentRequestAllowed(
								{
									senderId: win.webContents.id,
									frameURL: win.webContents.getURL(),
									mainFrame: true,
								},
								win.webContents.id,
								options.renderer,
							)
						)
							win.webContents.send(LOCALE_CHANGED, snapshot);
					}
				}
				return response;
			}),
		);
		tasks.add(task);
		try {
			const result = await task;
			if (!allowed(event) || event.sender.mainFrame !== frame)
				throw new Error("QUAKE.SETTINGS.UNAUTHORIZED");
			return result;
		} finally {
			tasks.delete(task);
			pending--;
		}
	});
	return {
		/** Main consumers share the same settings runtime and durable selection. */
		locale: (): Promise<LocaleSnapshot> =>
			runtime.runPromise(SettingsService.use((service) => service.locale())),
		onLocaleChanged: (listener: (snapshot: LocaleSnapshot) => void) => {
			localeListeners.add(listener);
			return () => localeListeners.delete(listener);
		},
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			localeListeners.clear();
			ipcMain.removeHandler(LOCALE_REQUEST);
			await Promise.allSettled(tasks);
			await runtime.dispose();
		},
	};
}

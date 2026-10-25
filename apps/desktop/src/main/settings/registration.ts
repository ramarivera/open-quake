import { Effect, Layer } from "effect";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { GeneralSettingsService } from "../../../../../packages/edge/src/settings/general-service";
import type { LocaleSnapshot } from "../../../../../packages/edge/src/settings/settings-contracts";
import {
	SettingsOsApplyFailed,
	WizardIncomplete,
} from "../../../../../packages/edge/src/settings/settings-errors";
import {
	SettingsOsPort,
	WizardOwners,
} from "../../../../../packages/edge/src/settings/settings-ports";
import { SettingsRepository } from "../../../../../packages/edge/src/settings/settings-repository";
import { SettingsService } from "../../../../../packages/edge/src/settings/settings-service";
import { WizardService } from "../../../../../packages/edge/src/settings/wizard-service";
import { LOCALE_CHANGED, LOCALE_REQUEST } from "../../shared/locale";
import { SETTINGS_BACKEND_REQUEST } from "../../shared/settings-backend";
import { agentRequestAllowed } from "../agents/controller";
import type { DesktopDiagnostics } from "../diagnostics";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import {
	decodeSettingsBackendRequest,
	handleSettingsBackendRequest,
} from "./backend-rpc";
import { decodeLocaleRequest, handleLocaleRequest } from "./rpc";
import { desktopSettingsStorage } from "./storage";

export function registerAppLocale(options: {
	readonly directory: string;
	readonly osLocale: string;
	readonly renderer: string;
	readonly windows: () => readonly (BrowserWindow | undefined)[];
	readonly diagnostics?: DesktopDiagnostics;
	readonly backend?: {
		readonly os: typeof SettingsOsPort.Service;
		readonly owners: typeof WizardOwners.Service;
	};
}) {
	const repository = SettingsRepository.Default.pipe(
		Layer.provide(desktopSettingsStorage(options.directory, options.osLocale)),
	);
	const unavailable = () =>
		Effect.fail(new SettingsOsApplyFailed(undefined, "unsupported"));
	const os: typeof SettingsOsPort.Service = options.backend?.os ?? {
		login: unavailable,
		setLogin: unavailable,
		workAreas: unavailable,
		managementReachable: unavailable,
	};
	const owners: typeof WizardOwners.Service = options.backend?.owners ?? {
		displayAvailable: () => Effect.fail(new WizardIncomplete()),
		usableProfiles: () => Effect.fail(new WizardIncomplete()),
		runtimeSupported: Effect.succeed(false),
		runtimeConfigured: Effect.succeed(false),
		regionSuggestions: () => Effect.succeed({}),
	};
	const runtime = makeDesktopRuntime(
		Layer.mergeAll(
			SettingsService.DefaultWithoutDependencies,
			GeneralSettingsService.DefaultWithoutDependencies,
			WizardService.DefaultWithoutDependencies,
		).pipe(
			Layer.provide(repository),
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(SettingsOsPort, os),
					Layer.succeed(WizardOwners, owners),
				),
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
	const publishLocale = (snapshot: LocaleSnapshot): void => {
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
	};
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
					response._tag === "Exit" &&
					response.exit._tag === "Success" &&
					message._tag === "Request" &&
					message.tag === "settings.setLocale"
				) {
					const snapshot = yield* Effect.flatMap(SettingsService, (service) =>
						service.locale(),
					);
					publishLocale(snapshot);
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
	// General preferences can touch OS login state, so only the owned management
	// main frame may call this group. Panel access remains locale-only.
	const allowedBackend = (event: IpcMainInvokeEvent): boolean =>
		allowed(event) && event.sender.id === options.windows()[0]?.webContents.id;
	ipcMain.handle(SETTINGS_BACKEND_REQUEST, async (event, input: unknown) => {
		const message = decodeSettingsBackendRequest(input);
		if (!allowedBackend(event) || !message || pending >= 16)
			throw new Error("QUAKE.SETTINGS.UNAUTHORIZED");
		const frame = event.senderFrame;
		pending++;
		const task = runtime.runPromise(
			Effect.gen(function* () {
				const response = yield* handleSettingsBackendRequest(message);
				if (
					!disposed &&
					response._tag === "Exit" &&
					response.exit._tag === "Success" &&
					message._tag === "Request" &&
					message.tag === "wizard.save"
				) {
					publishLocale(
						yield* SettingsService.use((service) => service.locale()),
					);
				}
				return response;
			}),
		);
		tasks.add(task);
		try {
			const response = await task;
			if (!allowedBackend(event) || event.sender.mainFrame !== frame)
				throw new Error("QUAKE.SETTINGS.UNAUTHORIZED");
			return response;
		} finally {
			tasks.delete(task);
			pending--;
		}
	});

	return {
		startup: () =>
			runtime.runPromise(
				GeneralSettingsService.use((service) => service.startup()),
			),
		saveWindow: (
			window: import("../../../../../packages/edge/src/settings/general-contracts").WindowRectangle,
		) =>
			runtime.runPromise(
				GeneralSettingsService.use((service) => service.save({ window })),
			),
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
			ipcMain.removeHandler(SETTINGS_BACKEND_REQUEST);
			await Promise.allSettled(tasks);
			await runtime.dispose();
		},
	};
}

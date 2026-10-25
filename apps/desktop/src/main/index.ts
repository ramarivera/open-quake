import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { NodeHidLive } from "@open-quake/device/node-hid";
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from "effect";
import {
	app,
	BrowserWindow,
	type Display,
	dialog,
	ipcMain,
	nativeTheme,
	powerMonitor,
	screen,
	shell,
} from "electron";
import { KnobDispatchFailed } from "../../../../packages/device/src/knob/knob-errors.js";
import { ProfileService } from "../../../../packages/device/src/profiles/profile-service.js";
import { RuntimeStorageFailed } from "../../../../packages/edge/src/agent-http/runtime-errors.js";
import { MaintenanceShutdownFailed } from "../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { QUAKE_EVENT_CHANNEL, QUAKE_STATUS_CHANNEL } from "../preload/quake";
import { LIFECYCLE_STATUS } from "../shared/lifecycle-contracts";
import type { VoiceSurfaceEvent } from "../shared/voice-surface";
import { registerAgentHttp } from "./agent-http";
import { registerAgents } from "./agents";
import { ClockLive, registerClock, registerClockScheme } from "./clock";
import { type DeviceBus, startDeviceBus } from "./deviceBus";
import {
	findPanelDisplay,
	type PanelRotation,
	panelBounds,
	panelRotation,
} from "./display";
import { registerEmoji } from "./emoji";
import { createEventForwarder } from "./eventForwarding";
import { registerHardware } from "./hardware";
import { attachHardware, startMockHardwareBus } from "./hardware/bus";
import { hardwarePreferencesLive } from "./hardware/preferences";
import { registerIntegrations } from "./integrations";
import { integrationKeyAction } from "./integrations/key-action";
import { resetKeysOnLinkLoss } from "./key-library/device-status";
import { registerKnob } from "./knob";
import { knobProfileBinding } from "./knob/profile-binding";
import { DeviceLifecycle } from "./lifecycle/lifecycle-service";
import {
	callDisplayTool,
	DisplayOperationFailed,
	farRightOrigins,
	probeHiddenMirroring,
} from "./lifecycle/native-display";
import { registerLifecycle } from "./lifecycle/registration";
import { registerMaintenance } from "./maintenance";
import {
	readNativeTheme,
	registerManagementAppearance,
} from "./management/appearance";
import { managementAgentCredentials } from "./management/credentials";
import { MediaLive, registerMedia } from "./media";
import { registerMeetings } from "./meetings";
import { registerMonitor } from "./monitor";
import { registerProfiles } from "./profiles";
import { createToneRecorder, registerVoiceSurface, toneSinks } from "./voice";
import { registerWeatherMedia, weatherMediaLive } from "./weather-media";

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const rendererURL =
	isDev && process.env.ELECTRON_RENDERER_URL
		? process.env.ELECTRON_RENDERER_URL
		: pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
registerClockScheme();
const PANEL_TITLE = "open-quake panel";

interface PanelTarget {
	readonly display: Display;
	/** True when the display is the QUAKE strip, not a fallback. */
	readonly isPanel: boolean;
}

function loadSurface(
	win: BrowserWindow,
	surface: "management" | "panel",
	rotation: PanelRotation = 0,
): void {
	const query = { surface, rotation: String(rotation) };
	if (isDev) {
		win.loadURL(
			`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`,
		);
	} else {
		win.loadFile(join(import.meta.dirname, "../renderer/index.html"), {
			query,
		});
	}
}

function placePanel(win: BrowserWindow, { display, isPanel }: PanelTarget) {
	win.setBounds(panelBounds(display, isPanel));
	// Cover the menu bar macOS draws on every display; only on the strip itself.
	win.setAlwaysOnTop(isPanel, "screen-saver");
}

function createPanelWindow(target: PanelTarget): BrowserWindow {
	const win = new BrowserWindow({
		...panelBounds(target.display, target.isPanel),
		title: PANEL_TITLE,
		show: !target.isPanel && isDev,
		frame: false,
		// An NSPanel is not a standard window, so tiling managers leave the strip
		// alone. The fallback stays a normal window on the current Space.
		...(target.isPanel && process.platform === "darwin"
			? { type: "panel" }
			: {}),
		resizable: false,
		enableLargerThanScreen: true,
		fullscreenable: true,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	// OmniWM matches this title even while HTML/navigation titles change.
	win.on("page-title-updated", (event) => event.preventDefault());
	placePanel(win, target);
	loadSurface(win, "panel", panelRotation(target.display, target.isPanel));
	return win;
}

function createManagementWindow(): BrowserWindow {
	const theme = readNativeTheme(app.getPath("userData"));
	nativeTheme.themeSource = theme.base;
	const win = new BrowserWindow({
		width: 1100,
		height: 760,
		title: "open-quake — management",
		minWidth: 640,
		minHeight: 560,
		backgroundColor: theme.background,
		...(process.platform === "darwin"
			? ({ titleBarStyle: "hiddenInset" } as const)
			: process.platform === "win32"
				? ({
						titleBarStyle: "hidden",
						titleBarOverlay: {
							color: theme.titlebar,
							symbolColor: theme.symbol,
							height: 55,
						},
					} as const)
				: {}),
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	loadSurface(win, "management");
	return win;
}

if (!app.requestSingleInstanceLock()) {
	process.stderr.write(
		"open-quake is already running. Refusing a second device connection; focusing the existing management window.\n",
	);
	app.quit();
} else
	app.whenReady().then(async () => {
		const getPanelTarget = (): PanelTarget => {
			const display = findPanelDisplay(screen.getAllDisplays());
			return display
				? { display, isPanel: true }
				: { display: screen.getPrimaryDisplay(), isPanel: false };
		};
		let panelTarget = getPanelTarget();
		let panelWin = createPanelWindow(panelTarget);
		let managementWin = createManagementWindow();
		const removeManagementAppearance = registerManagementAppearance(
			() => managementWin,
			app.getPath("userData"),
			rendererURL,
		);
		const weatherMedia = registerWeatherMedia(
			ManagedRuntime.make(
				weatherMediaLive(app.getPath("userData"), process.platform),
			),
			() => managementWin,
		);
		let bus: DeviceBus | undefined;
		let resetVoice = (): Promise<void> => Promise.resolve();
		let publishVoice = (_event: VoiceSurfaceEvent): Promise<void> =>
			Promise.resolve();
		const agentHttp = await Effect.runPromise(
			Effect.tryPromise({
				try: () =>
					registerAgentHttp({
						management: () => managementWin,
						renderer: rendererURL,
						invalidated: () => resetVoice(),
						publish: (event) => publishVoice(event),
					}),
				catch: (cause) => new RuntimeStorageFailed(cause),
			}).pipe(
				Effect.catchTag("RuntimeStorageFailed", (error) =>
					Effect.logWarning("HTTP runtime setup failed", {
						code: error.code,
					}).pipe(Effect.as(undefined)),
				),
			),
		);
		// Voice overlay, hold-to-talk and on-strip chat (strip-voice-ui). Tones
		// play through hardware-controls; the mock bus answers them without HID.
		const voice = registerVoiceSurface({
			...(agentHttp ? { runtime: agentHttp.decorateVoiceRuntime } : {}),
			mock: process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
			tones: toneSinks(createToneRecorder(), {
				play: (_serial, tone) => {
					const hardware = bus?.hardware?.();
					if (hardware)
						runtime.runFork(
							hardware.playTone(tone).pipe(
								Effect.tapError((error) =>
									Effect.logWarning("Voice tone failed", error.code),
								),
								Effect.ignore,
							),
						);
				},
			}),
			serial: () => "quake",
			panel: () => panelWin,
			management: () => managementWin,
		});
		resetVoice = voice.reset;
		publishVoice = voice.publish;
		const managementURL = new URL(rendererURL);
		managementURL.searchParams.set("surface", "management");
		managementURL.searchParams.set("rotation", "0");
		const profiles = registerProfiles(
			() => managementWin,
			rendererURL,
			undefined,
			managementURL.href,
			() => bus?.hardware?.(),
			() => panelWin,
			integrationKeyAction((key, signal) =>
				integrations.executeHaFromKey(key, signal),
			),
		);
		const agents = registerAgents({
			...(agentHttp
				? { backend: agentHttp.backend, drafting: agentHttp.drafting }
				: {}),
			management: () => managementWin,
			renderer: rendererURL,
			profiles: profiles.runtime,
			credentials: managementAgentCredentials(
				join(app.getPath("userData"), "agent-credentials"),
			),
		});
		const integrations = registerIntegrations({
			panel: () => panelWin,
			management: () => managementWin,
			rendererURL,
			profileRuntime: profiles.runtime,
		});
		const emoji = registerEmoji({
			selectionSerial: () => media.selectionSerial(),
			management: () => managementWin,
			panel: () => panelWin,
			profiles,
			bus: () => bus,
			renderer: rendererURL,
			mock: process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
		});
		const knob = registerKnob(
			() => panelWin,
			() => [panelWin, managementWin],
			{
				profiles: knobProfileBinding(profiles.runtime, profiles.select),
				hardware: () => bus?.hardware?.(),
				voice: voice.knobVoice,
			},
		);
		const focusManagement = (): void => {
			if (quitting) return;
			reopenWindows();
			if (managementWin.isDestroyed()) managementWin = createManagementWindow();
			if (managementWin.isMinimized()) managementWin.restore();
			managementWin.show();
			managementWin.focus();
		};
		app.on("second-instance", focusManagement);
		const media = registerMedia(
			ManagedRuntime.make(
				MediaLive(join(app.getPath("userData"), "wallpaper-v1")),
			),
			() => managementWin,
		);
		const clock = registerClock(
			ManagedRuntime.make(ClockLive(app.getPath("userData"))),
			() => managementWin,
		);
		const monitor = registerMonitor(
			app.getPath("userData"),
			() => managementWin,
			() => panelWin,
		);
		const profileUpdates = profiles.runtime.runFork(
			ProfileService.subscribeCommittedProfiles().pipe(
				Effect.flatMap((snapshots) =>
					Stream.runForEach(snapshots, () =>
						Effect.tryPromise({
							try: () => knob.refresh(),
							catch: KnobDispatchFailed.fromCause,
						}).pipe(
							Effect.catchTag("KnobDispatchFailed", (error) =>
								Effect.logWarning("Refreshing knob profiles failed", {
									code: error.code,
								}),
							),
						),
					),
				),
			),
		);
		// One service layer for the main process. Only this Electron boundary runs it.
		const runtime = ManagedRuntime.make(
			Layer.merge(
				QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(NodeHidLive)),
				HardwareControls.DefaultWithoutDependencies.pipe(
					Layer.provide(
						hardwarePreferencesLive(
							join(app.getPath("userData"), "hardware-v1"),
						),
					),
				),
			),
		);
		const mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1";
		const meetings = registerMeetings({
			userData: app.getPath("userData"),
			hardware: () => bus?.hardware?.(),
			mock,
		});
		const source = mock
			? startMockHardwareBus()
			: Effect.gen(function* () {
					const controls = yield* HardwareControls;
					return yield* startDeviceBus((connection) =>
						Effect.gen(function* () {
							const serial = connection.info.serialNumber;
							if (serial)
								yield* Effect.acquireRelease(
									Effect.tryPromise(() => profiles.connect(serial)).pipe(
										Effect.catchAll(() =>
											Effect.logWarning("Profile session enrollment failed"),
										),
									),
									() =>
										Effect.tryPromise(() => profiles.disconnect(serial)).pipe(
											Effect.catchAll(() =>
												Effect.logWarning("Profile session cleanup failed"),
											),
										),
								);
							return yield* attachHardware(controls, connection);
						}),
					);
				});
		const disposeHardware = registerHardware(
			() => bus?.hardware?.(),
			() => managementWin,
			mock,
		);
		let running:
			| Fiber.RuntimeFiber<void, Effect.Effect.Error<typeof source>>
			| undefined;
		let stopping = Promise.resolve();
		let generation = 0;
		let quitting = false;
		let quitFinished = false;
		const lifecycleRuntime = ManagedRuntime.make(
			DeviceLifecycle.Default({
				mock,
				development: isDev,
				displays: () => screen.getAllDisplays(),
				bus: () => bus,
				watch: (changed) => {
					screen.on("display-added", changed);
					screen.on("display-removed", changed);
					screen.on("display-metrics-changed", changed);
					return () => {
						screen.removeListener("display-added", changed);
						screen.removeListener("display-removed", changed);
						screen.removeListener("display-metrics-changed", changed);
					};
				},
				panel: (display, visible, fallback) => {
					if (!visible) {
						if (!panelWin.isDestroyed()) panelWin.hide();
						return;
					}
					if (display || fallback) syncPanelDisplay(display);
					if (!panelWin.isDestroyed()) panelWin.showInactive();
				},
				notify: (status) => {
					if (!managementWin.isDestroyed())
						managementWin.webContents.send(LIFECYCLE_STATUS, status);
				},
				prompts: {
					hiddenMirroring: () =>
						mock || process.platform !== "darwin"
							? Effect.succeed(false)
							: probeHiddenMirroring(),
					platform: process.platform,
					mock,
					displays: () => screen.getAllDisplays(),
					primaryId: () => screen.getPrimaryDisplay().id,
					prompt: (options) =>
						Effect.tryPromise({
							try: () =>
								dialog
									.showMessageBox(managementWin, {
										...options,
										type: "warning",
										noLink: true,
									})
									.then((result) => result.response),
							catch: (cause) => new DisplayOperationFailed(cause),
						}),
					openSettings: () =>
						Effect.tryPromise({
							try: () =>
								process.platform === "darwin"
									? shell.openExternal(
											"x-apple.systempreferences:com.apple.preference.displays",
										)
									: process.platform === "win32"
										? shell.openExternal("ms-settings:display")
										: Promise.resolve(),
							catch: (cause) => new DisplayOperationFailed(cause),
						}),
					native: (action, display) =>
						mock || process.platform !== "darwin"
							? Effect.succeed("unavailable")
							: callDisplayTool(
									action,
									display.id,
									farRightOrigins(
										screen.getAllDisplays(),
										display,
										screen.getPrimaryDisplay().id,
									),
								),
				},
			}),
		);
		const lifecycle = lifecycleRuntime.runPromise(DeviceLifecycle);
		const removeLifecycle = registerLifecycle(
			lifecycleRuntime,
			() => managementWin,
			process.env.ELECTRON_RENDERER_URL ??
				pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
		);
		const onLock = (): void => {
			void lifecycle.then((service) =>
				lifecycleRuntime.runPromise(service.lock()),
			);
		};
		const onWake = (): void => {
			void lifecycle.then((service) =>
				lifecycleRuntime.runPromise(service.wake()),
			);
		};
		powerMonitor.on("lock-screen", onLock);
		powerMonitor.on("unlock-screen", onWake);
		const onResume = (): void => {
			void lifecycle.then((service) =>
				lifecycleRuntime.runPromise(service.wake(false)),
			);
		};
		powerMonitor.on("resume", onResume);
		const startBus = (): void => {
			if (running || quitting) return;
			const requested = ++generation;
			// A reopened window waits for the old scope's native close to finish.
			void stopping.then(() => {
				if (quitting || requested !== generation || running) return;
				running = runtime.runFork(
					Effect.scoped(
						Effect.gen(function* () {
							bus = yield* source;
							const forward = createEventForwarder(
								() => [panelWin, managementWin],
								() => [panelWin],
							);
							bus.on((event) => {
								// Gate new holds synchronously and cancel in main before
								// renderer touch teardown can synthesize a normal release.
								void voice.onDevice(event);
								forward(event);
								if (event.kind === "status") {
									void lifecycle.then((service) =>
										lifecycleRuntime.runPromise(service.onStatus(event)),
									);
									if (!mock)
										void resetKeysOnLinkLoss(event, profiles.resetKeys).catch(
											() => {},
										);
									if (mock) {
										const operation =
											event.state === "connected"
												? profiles.connect("desktop-preview")
												: profiles.disconnect("desktop-preview");
										void operation.catch(() => {});
									}
								}
							});
							bus.on(knob.onDevice);
							yield* Effect.never;
						}),
					),
				);
			});
		};
		const stopBus = (): Promise<void> => {
			generation++;
			bus = undefined;
			const fiber = running;
			running = undefined;
			if (fiber) {
				stopping = stopping.then(async () => {
					await voice.onDevice({
						source: mock ? "mock" : "hid",
						kind: "status",
						state: "disconnected",
						reason: "scope-closed",
					});
					if (mock) await profiles.disconnect("desktop-preview");
					else await profiles.resetKeys();
					await lifecycle.then((service) =>
						lifecycleRuntime.runPromise(service.lock()),
					);
					await runtime.runPromise(Fiber.interrupt(fiber));
					bus = undefined;
				});
			}
			return stopping;
		};
		const syncPanelDisplay = (display?: Display): void => {
			const previous = panelTarget;
			panelTarget = display
				? { display, isPanel: true }
				: { display: screen.getPrimaryDisplay(), isPanel: false };
			if (panelWin.isDestroyed()) {
				panelWin = createPanelWindow(panelTarget);
			} else if (panelTarget.isPanel !== previous.isPanel) {
				// The window type is fixed at creation; swap before closing the old one
				// so the bus never sees zero windows.
				const old = panelWin;
				panelWin = createPanelWindow(panelTarget);
				old.destroy();
			} else {
				placePanel(panelWin, panelTarget);
				const rotation = panelRotation(
					panelTarget.display,
					panelTarget.isPanel,
				);
				if (rotation !== panelRotation(previous.display, previous.isPanel))
					loadSurface(panelWin, "panel", rotation);
			}
			startBus();
		};
		const topologyChanged = (): void => {
			// Hide synchronously so an OS relocation cannot expose the strip on primary.
			if (
				panelTarget.isPanel &&
				!screen.getAllDisplays().some((d) => d.id === panelTarget.display.id) &&
				!panelWin.isDestroyed()
			)
				panelWin.hide();
			void lifecycle.then((service) =>
				lifecycleRuntime.runPromise(service.topology()),
			);
		};
		screen.on("display-added", topologyChanged);
		screen.on("display-removed", topologyChanged);
		screen.on("display-metrics-changed", topologyChanged);

		startBus();
		// Preload asks after registering its listener, including after reloads.
		const sendStatus = (event: Electron.IpcMainEvent): void => {
			const status = bus?.currentStatus();
			if (status && !event.sender.isDestroyed()) {
				event.sender.send(QUAKE_EVENT_CHANNEL, status);
			}
		};
		ipcMain.on(QUAKE_STATUS_CHANNEL, sendStatus);

		let shutdown: Promise<void> | undefined;
		const stopWriters = (closeWindows = false): Promise<void> => {
			if (shutdown) return shutdown;
			quitting = true;
			screen.removeListener("display-added", topologyChanged);
			screen.removeListener("display-removed", topologyChanged);
			screen.removeListener("display-metrics-changed", topologyChanged);
			powerMonitor.removeListener("lock-screen", onLock);
			powerMonitor.removeListener("unlock-screen", onWake);
			powerMonitor.removeListener("resume", onResume);
			app.removeListener("second-instance", focusManagement);
			removeLifecycle();
			removeManagementAppearance();
			disposeHardware();
			ipcMain.removeListener(QUAKE_STATUS_CHANNEL, sendStatus);
			shutdown = (async () => {
				await stopBus();
				await weatherMedia.dispose();
				await meetings.dispose();
				await monitor.dispose();
				await lifecycleRuntime.dispose();
				await profiles.runtime.runPromise(Fiber.interrupt(profileUpdates));
				await knob.dispose();
				await Promise.all([
					agents.dispose(),
					integrations.dispose(),
					emoji.dispose(),
				]);
				await agentHttp?.dispose();
				await voice.dispose();
				await profiles.dispose();
				await clock.dispose();
				await media.dispose();
				await runtime.dispose();
				if (closeWindows) {
					if (!managementWin.isDestroyed()) {
						managementWin.webContents.session.flushStorageData();
						managementWin.destroy();
					}
					if (!panelWin.isDestroyed()) panelWin.destroy();
				}
			})();
			return shutdown;
		};
		const maintenance = registerMaintenance({
			root: app.getPath("userData"),
			mock,
			renderer: rendererURL,
			hardware: () => bus?.hardware?.(),
			management: () => managementWin,
			stopWriters: () => stopWriters(true),
		});
		app.on("before-quit", (event) => {
			if (quitFinished) return;
			event.preventDefault();
			if (quitting) return;
			quitting = true;
			const reportFailure = (cause: unknown): void => {
				const error =
					cause instanceof MaintenanceShutdownFailed
						? cause
						: new MaintenanceShutdownFailed(cause);
				Effect.runSync(
					Effect.logError("Application shutdown failed", {
						code: error.code,
						diagnosticCause: error.diagnosticCause,
					}),
				);
			};
			void maintenance
				.dispose()
				.catch(reportFailure)
				.then(() => stopWriters())
				.catch(reportFailure)
				.then(() => {
					quitFinished = true;
					app.quit();
				});
		});

		const reopenWindows = (): void => {
			if (quitting) return;
			if (managementWin.isDestroyed()) {
				if (panelWin.isDestroyed())
					syncPanelDisplay(findPanelDisplay(screen.getAllDisplays()));
				managementWin = createManagementWindow();
				startBus();
				// stopBus locks the lifecycle before releasing the old owner.
				// Unlock only after that stop completes, including rapid reopening.
				void stopping.then(() => {
					if (!quitting && BrowserWindow.getAllWindows().length > 0) onWake();
				});
			}
		};
		app.on("activate", focusManagement);
		app.on("window-all-closed", () => {
			void stopBus();
			if (process.platform !== "darwin") app.quit();
		});
	});

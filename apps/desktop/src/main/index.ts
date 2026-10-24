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
	powerMonitor,
	screen,
	shell,
} from "electron";
import { KnobDispatchFailed } from "../../../../packages/device/src/knob/knob-errors.js";
import { ProfileService } from "../../../../packages/device/src/profiles/profile-service.js";
import { QUAKE_EVENT_CHANNEL, QUAKE_STATUS_CHANNEL } from "../preload/quake";
import { LIFECYCLE_STATUS } from "../shared/lifecycle-contracts";
import { ClockLive, registerClock, registerClockScheme } from "./clock";
import { type DeviceBus, startDeviceBus } from "./deviceBus";
import {
	findPanelDisplay,
	type PanelRotation,
	panelBounds,
	panelRotation,
} from "./display";
import { createEventForwarder } from "./eventForwarding";
import { registerHardware } from "./hardware";
import { attachHardware, startMockHardwareBus } from "./hardware/bus";
import { hardwarePreferencesLive } from "./hardware/preferences";
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
import { MediaLive, registerMedia } from "./media";
import { registerProfiles } from "./profiles";
import { createToneRecorder, registerVoiceSurface, toneSinks } from "./voice";

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const rendererURL =
	isDev && process.env.ELECTRON_RENDERER_URL
		? process.env.ELECTRON_RENDERER_URL
		: pathToFileURL(join(__dirname, "../renderer/index.html")).href;
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
		win.loadFile(join(__dirname, "../renderer/index.html"), { query });
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
			preload: join(__dirname, "../preload/index.mjs"),
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
	const win = new BrowserWindow({
		width: 1100,
		height: 760,
		title: "open-quake — management",
		webPreferences: {
			preload: join(__dirname, "../preload/index.mjs"),
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
	app.whenReady().then(() => {
		const getPanelTarget = (): PanelTarget => {
			const display = findPanelDisplay(screen.getAllDisplays());
			return display
				? { display, isPanel: true }
				: { display: screen.getPrimaryDisplay(), isPanel: false };
		};
		let panelTarget = getPanelTarget();
		let panelWin = createPanelWindow(panelTarget);
		let managementWin = createManagementWindow();
		let bus: DeviceBus | undefined;
		// Voice overlay, hold-to-talk and on-strip chat (strip-voice-ui). Tones
		// play through hardware-controls; the mock bus answers them without HID.
		const voice = registerVoiceSurface({
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
		const managementURL = new URL(rendererURL);
		managementURL.searchParams.set("surface", "management");
		managementURL.searchParams.set("rotation", "0");
		const profiles = registerProfiles(
			() => managementWin,
			rendererURL,
			undefined,
			managementURL.href,
		);
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
		registerMedia(
			ManagedRuntime.make(
				MediaLive(join(app.getPath("userData"), "wallpaper-v1")),
			),
			() => managementWin,
		);
		registerClock(
			ManagedRuntime.make(ClockLive(app.getPath("userData"))),
			() => managementWin,
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
		const source = mock
			? startMockHardwareBus()
			: Effect.gen(function* () {
					const controls = yield* HardwareControls;
					return yield* startDeviceBus((connection) =>
						attachHardware(controls, connection),
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
				pathToFileURL(join(__dirname, "../renderer/index.html")).href,
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
								forward(event);
								if (event.kind === "status") {
									void lifecycle.then((service) =>
										lifecycleRuntime.runPromise(service.onStatus(event)),
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
					if (mock) await profiles.disconnect("desktop-preview");
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

		app.on("before-quit", (event) => {
			if (quitFinished) return;
			// Electron does not await async listeners. Keep it alive for HID finalizers.
			event.preventDefault();
			if (quitting) return;
			quitting = true;
			screen.removeListener("display-added", topologyChanged);
			screen.removeListener("display-removed", topologyChanged);
			screen.removeListener("display-metrics-changed", topologyChanged);
			powerMonitor.removeListener("lock-screen", onLock);
			powerMonitor.removeListener("unlock-screen", onWake);
			powerMonitor.removeListener("resume", onResume);
			app.removeListener("second-instance", focusManagement);
			removeLifecycle();
			disposeHardware();
			ipcMain.removeListener(QUAKE_STATUS_CHANNEL, sendStatus);
			void stopBus().then(async () => {
				await lifecycleRuntime.dispose();
				await profiles.runtime.runPromise(Fiber.interrupt(profileUpdates));
				await knob.dispose();
				await voice.dispose();
				await profiles.dispose();
				await runtime.dispose();
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

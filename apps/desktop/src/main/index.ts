import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { NodeHidLive } from "@open-quake/device/node-hid";
import { Effect, Fiber, Layer, Stream } from "effect";
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
import { ProfileManager } from "../../../../packages/device/src/profiles/profile-manager-service.js";
import { ProfileService } from "../../../../packages/device/src/profiles/profile-service.js";
import { AgentsService } from "../../../../packages/edge/src/agents/agents-service";
import { AiConfigInvalid } from "../../../../packages/edge/src/ai/ai-errors";
import { MaintenanceShutdownFailed } from "../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type { LocaleSnapshot } from "../../../../packages/edge/src/settings/settings-contracts";
import { QUAKE_EVENT_CHANNEL, QUAKE_STATUS_CHANNEL } from "../preload/quake";
import { LIFECYCLE_STATUS } from "../shared/lifecycle-contracts";
import type { VoiceSurfaceEvent } from "../shared/voice-surface";
import { prepareAgentHttp } from "./agent-http";
import { registerUnavailableAgentConnections } from "./agent-http/unavailable-registration";
import { prepareAgents } from "./agents";
import { createModelCredentials } from "./chat/credentials";
import { prepareDirectChat } from "./chat/host";
import { registerDirectChat } from "./chat/registration";
import { createDirectChatVoice } from "./chat/voice";
import { ClockLive, registerClock, registerClockScheme } from "./clock";
import { type DeviceBus, startDeviceBus } from "./deviceBus";
import { createDesktopDiagnostics } from "./diagnostics";
import { prepareDesktopModule } from "./diagnostics/module";
import { makeDesktopRuntime } from "./diagnostics/runtime";
import {
	findPanelDisplay,
	type PanelRotation,
	panelBounds,
	panelRotation,
} from "./display";
import { prepareEmoji } from "./emoji";
import { createEventForwarder } from "./eventForwarding";
import { registerHardware } from "./hardware";
import { attachHardware, startMockHardwareBus } from "./hardware/bus";
import { hardwarePreferencesLive } from "./hardware/preferences";
import { prepareIntegrations } from "./integrations";
import { integrationKeyAction } from "./integrations/key-action";
import { fileStore, systemCredentialVault } from "./integrations/storage";
import { resetKeysOnLinkLoss } from "./key-library/device-status";
import { prepareKnob } from "./knob";
import { knobProfileBinding } from "./knob/profile-binding";
import { DeviceLifecycle } from "./lifecycle/lifecycle-service";
import {
	callDisplayTool,
	DisplayOperationFailed,
	farRightOrigins,
	probeHiddenMirroring,
} from "./lifecycle/native-display";
import { registerLifecycle } from "./lifecycle/registration";
import { prepareMaintenance } from "./maintenance";
import {
	readNativeTheme,
	registerManagementAppearance,
} from "./management/appearance";
import { MediaLive, registerMedia } from "./media";
import { prepareMeetings } from "./meetings";
import { prepareMonitor } from "./monitor";
import { prepareProfiles } from "./profiles";
import { createSettingsOsAdapter } from "./settings/os-adapter";
import { prepareAppLocale } from "./settings/registration";
import { bindSettingsWindow } from "./settings/window-binding";
import { createWizardOwners } from "./settings/wizard-owners";
import { emptySpeechSettings, registerSpeechSettings } from "./speech";
import { createSpeechVoiceBinding } from "./speech/composition";
import { createToneRecorder, prepareVoiceSurface, toneSinks } from "./voice";
import { registerWeatherMedia, weatherMediaLive } from "./weather-media";
import { systemMediaKeyActions } from "./weather-media/key-actions";
import { SystemMediaService } from "./weather-media/system-media";

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
		roundedCorners: false,
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
	return win;
}

function createManagementWindow(): BrowserWindow {
	const theme = readNativeTheme(app.getPath("userData"));
	nativeTheme.themeSource = theme.base;
	const win = new BrowserWindow({
		width: 1100,
		height: 760,
		title: "open-quake — management",
		show: false,
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
	return win;
}

if (!app.requestSingleInstanceLock()) {
	process.stderr.write(
		"open-quake is already running. Refusing a second device connection; focusing the existing management window.\n",
	);
	app.quit();
} else
	app.whenReady().then(async () => {
		const diagnostics = createDesktopDiagnostics({
			directory: join(app.getPath("userData"), "diagnostics"),
		});
		await Effect.runPromise(
			diagnostics
				.instrument(
					Effect.promise(async () => {
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
						const backgroundModule = prepareDesktopModule(
							Layer.empty,
							(runtime) => runtime,
							diagnostics,
						);
						const background = backgroundModule.runtime;
						const weatherModule = prepareDesktopModule(
							weatherMediaLive(app.getPath("userData"), process.platform),
							(runtime) => registerWeatherMedia(runtime, () => managementWin),
							diagnostics,
						);
						const mediaActions = systemMediaKeyActions((command, signal) =>
							weatherModule.runtime.runPromise(
								SystemMediaService.send(command),
								{ signal },
							),
						);
						let bus: DeviceBus | undefined;
						let activeSerial: string | undefined;
						const activeDeviceId = () => activeSerial ?? "desktop-preview";
						let knobLocale: LocaleSnapshot["locale"] = "en";
						let resetVoice = (): Promise<void> => Promise.resolve();
						let publishVoice = (_event: VoiceSurfaceEvent): Promise<void> =>
							Promise.resolve();
						const httpModule = prepareAgentHttp({
							diagnostics,
							management: () => managementWin,
							renderer: rendererURL,
							invalidated: () => resetVoice(),
							publish: (event) => publishVoice(event),
						});
						let agentHttp: Awaited<ReturnType<typeof httpModule.start>>;
						const modelCredentials = await Effect.runPromise(
							createModelCredentials(
								systemCredentialVault(
									join(app.getPath("userData"), "agent-credentials"),
								),
							),
						);
						const directModule = prepareDirectChat({
							directory: join(app.getPath("userData"), "chat"),
							credentials: modelCredentials.ai,
							diagnostics,
							models: (scope) =>
								Effect.tryPromise({
									try: () =>
										agentsModule.runtime.runPromise(
											AgentsService.resolve(scope),
										),
									catch: (cause) => new AiConfigInvalid(cause),
								}),
						});
						const localeModule = prepareAppLocale({
							directory: app.getPath("userData"),
							osLocale: app.getLocale(),
							renderer: rendererURL,
							windows: () => [managementWin, panelWin],
							diagnostics,
							backend: {
								os: createSettingsOsAdapter({
									loginSupported:
										process.platform === "darwin" ||
										process.platform === "win32",
									getLoginItemSettings: async () => app.getLoginItemSettings(),
									setLoginItemSettings: async (settings) => {
										app.setLoginItemSettings(settings);
									},
									workAreas: async () =>
										screen.getAllDisplays().map((display) => display.workArea),
									managementReachable: async () =>
										process.platform === "darwin" &&
										Boolean(app.dock?.isVisible()) &&
										app.listenerCount("activate") > 0,
								}),
								owners: createWizardOwners({
									deviceId: async () => {
										const hardware = bus?.hardware?.();
										return hardware
											? background.runPromise(
													hardware
														.snapshot()
														.pipe(Effect.map((snapshot) => snapshot.serial)),
												)
											: undefined;
									},
									profiles: () =>
										profiles.runtime.runPromise(ProfileManager.read()),
									runtimeSupported: () => Boolean(agentHttp),
									runtimeConfigured: async () =>
										agentHttp ? agentHttp.configured() : false,
								}),
							},
						});
						const speech = createSpeechVoiceBinding({
							direct: (fallback) => createDirectChatVoice(directChat, fallback),
							speech: {
								storage: fileStore(
									app.getPath("userData"),
									"speech-v1.json",
									emptySpeechSettings,
								),
								credentials: systemCredentialVault(
									join(app.getPath("userData"), "credentials"),
								),
								diagnostics,
							},
							http: httpModule.createVoiceAdapter,
							run: (effect) => background.runPromise(effect),
						});
						const voiceModule = prepareVoiceSurface({
							diagnostics,
							runtime: speech.decorate,
							speech,
							mock: process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
							tones: toneSinks(createToneRecorder(), {
								play: (_serial, tone) => {
									const hardware = bus?.hardware?.();
									if (hardware)
										runtime.runFork(
											hardware.playTone(tone).pipe(
												Effect.tapError((error) =>
													Effect.logWarning("Voice tone failed", error),
												),
												Effect.ignore,
											),
										);
								},
							}),
							serial: activeDeviceId,
							panel: () => panelWin,
							management: () => managementWin,
						});
						const managementURL = new URL(rendererURL);
						managementURL.searchParams.set("surface", "management");
						managementURL.searchParams.set("rotation", "0");
						const profilesModule = prepareProfiles(
							() => managementWin,
							rendererURL,
							undefined,
							managementURL.href,
							() => bus?.hardware?.(),
							() => panelWin,
							integrationKeyAction((key, signal) =>
								integrations.executeHaFromKey(key, signal),
							),
							diagnostics,
							mediaActions,
						);
						const agentsModule = prepareAgents({
							diagnostics,
							backend: httpModule.backend,
							drafting: httpModule.drafting,
							management: () => managementWin,
							renderer: rendererURL,
							profiles: profilesModule.runtime,
							credentials: modelCredentials.management,
						});
						const integrationsModule = prepareIntegrations({
							diagnostics,
							panel: () => panelWin,
							management: () => managementWin,
							rendererURL,
							profileRuntime: profilesModule.runtime,
							draftShortcuts: (...args) => directChat.draftShortcuts(...args),
						});
						const emojiModule = prepareEmoji({
							diagnostics,
							selectionSerial: () => media.selectionSerial(),
							management: () => managementWin,
							panel: () => panelWin,
							get profiles() {
								return profiles;
							},
							bus: () => bus,
							renderer: rendererURL,
							mock: process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
						});
						const knobModule = prepareKnob(
							() => panelWin,
							() => [panelWin, managementWin],
							{
								deviceId: activeDeviceId,
								locale: () => knobLocale,
								profiles: knobProfileBinding(
									profilesModule.runtime,
									(...args) => profiles.select(...args),
								),
								thumbnail: (...args) => profiles.thumbnail(...args),
								hardware: () => bus?.hardware?.(),
								voice: (...args) => voice.knobVoice(...args),
							},
							diagnostics,
						);
						const mediaModule = prepareDesktopModule(
							MediaLive(join(app.getPath("userData"), "wallpaper-v1")),
							(runtime) =>
								registerMedia(runtime, () => managementWin, rendererURL, false),
							diagnostics,
						);
						const clockModule = prepareDesktopModule(
							ClockLive(app.getPath("userData"), profilesModule.runtime),
							(runtime) => registerClock(runtime, () => managementWin),
							diagnostics,
						);
						const monitorModule = prepareMonitor(
							app.getPath("userData"),
							() => managementWin,
							() => panelWin,
							undefined,
							rendererURL,
							diagnostics,
						);
						const hardwareModule = prepareDesktopModule(
							Layer.merge(
								QuakeDevice.DefaultWithoutDependencies.pipe(
									Layer.provide(NodeHidLive),
								),
								HardwareControls.DefaultWithoutDependencies.pipe(
									Layer.provide(
										hardwarePreferencesLive(
											join(app.getPath("userData"), "hardware-v1"),
										),
									),
								),
							),
							(runtime) => runtime,
							diagnostics,
						);
						const runtime = hardwareModule.runtime;
						const mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1";
						const meetingsModule = prepareMeetings({
							diagnostics,
							userData: app.getPath("userData"),
							hardware: () => bus?.hardware?.(),
							mock,
						});
						const lifecycleModule = prepareDesktopModule(
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
							(runtime) => runtime,
							diagnostics,
						);
						const maintenanceModule = prepareMaintenance({
							diagnostics,
							root: app.getPath("userData"),
							mock,
							renderer: rendererURL,
							hardware: () => bus?.hardware?.(),
							management: () => managementWin,
							stopWriters: async () => {
								const failures: unknown[] = [];
								for (const stop of [
									() => stopWriters(true),
									() => background.dispose(),
									() => application.dispose(),
								]) {
									try {
										await stop();
									} catch (cause) {
										failures.push(cause);
									}
								}
								if (failures.length)
									throw new MaintenanceShutdownFailed(
										new AggregateError(failures),
									);
							},
							exit: async (code) => {
								try {
									await background.dispose();
								} finally {
									try {
										await application.dispose();
									} finally {
										try {
											await diagnostics.close();
										} finally {
											app.exit(code);
										}
									}
								}
							},
						});

						// HTTP acquisition precedes voice decoration. The exact same layer is memoized in the one graph.
						const graph = Layer.mergeAll(
							backgroundModule.layer,
							weatherModule.layer,
							httpModule.layer,
							directModule.layer,
							localeModule.layer,
							voiceModule.layer.pipe(Layer.provide(httpModule.layer)),
							profilesModule.layer,
							agentsModule.layer.pipe(Layer.provide(httpModule.layer)),
							integrationsModule.layer,
							emojiModule.layer,
							knobModule.layer,
							mediaModule.layer,
							clockModule.layer,
							monitorModule.layer,
							hardwareModule.layer,
							meetingsModule.layer,
							lifecycleModule.layer,
							maintenanceModule.layer,
						);
						const application = makeDesktopRuntime(graph, diagnostics);
						backgroundModule.bind(application);
						weatherModule.bind(application);
						httpModule.bind(application);
						directModule.bind(application);
						localeModule.bind(application);
						voiceModule.bind(application);
						profilesModule.bind(application);
						agentsModule.bind(application);
						integrationsModule.bind(application);
						emojiModule.bind(application);
						knobModule.bind(application);
						mediaModule.bind(application);
						clockModule.bind(application);
						monitorModule.bind(application);
						hardwareModule.bind(application);
						meetingsModule.bind(application);
						lifecycleModule.bind(application);
						maintenanceModule.bind(application);
						// Construct the execution-only chat host before voice acquisition; this starts no IPC or work.
						const directChat = directModule.start();
						await application.runtime();
						const weatherMedia = weatherModule.start();
						agentHttp = await httpModule.start();
						const disposeUnavailableAgentConnections = agentHttp
							? () => {}
							: registerUnavailableAgentConnections({
									management: () => managementWin,
									renderer: rendererURL,
								});
						const localeRegistration = localeModule.start();
						const profiles = profilesModule.start();
						const agents = agentsModule.start();
						const integrations = integrationsModule.start();
						const media = mediaModule.start();
						const clock = clockModule.start();
						const emoji = emojiModule.start();
						const voice = voiceModule.start();
						await voice.ready;
						const knob = knobModule.start();
						const monitor = monitorModule.start();
						const meetings = meetingsModule.start();
						const lifecycleRuntime = lifecycleModule.start();
						const maintenance = maintenanceModule.start();
						const settingsWindow = bindSettingsWindow({
							startup: localeRegistration.startup,
							save: localeRegistration.saveWindow,
							failure: (cause) => {
								void background.runPromise(
									Effect.logWarning("Settings window operation failed", cause),
								);
							},
						});
						const chatRegistration = registerDirectChat({
							host: directChat,
							management: () => managementWin,
							panel: () => panelWin,
							renderer: rendererURL,
						});
						const removeSpeechSettings = registerSpeechSettings({
							controller: speech.settings,
							management: () => managementWin,
							renderer: rendererURL,
							instrument: diagnostics.instrument,
							run: (effect) => background.runPromise(effect),
						});
						resetVoice = voice.reset;
						publishVoice = voice.publish;
						let knobLocaleRevision = -1;
						const synchronizeKnobLocale = (snapshot: LocaleSnapshot): void => {
							if (snapshot.revision < knobLocaleRevision) return;
							const changed = knobLocale !== snapshot.locale;
							knobLocale = snapshot.locale;
							knobLocaleRevision = snapshot.revision;
							if (changed)
								void knob.refresh().catch(() => {
									// The instrumented knob runtime retains the failed exit.
								});
						};
						const removeKnobLocale = localeRegistration.onLocaleChanged(
							synchronizeKnobLocale,
						);
						// A corrupt settings document remains visible through its original
						// IPC failure and diagnostics; it must not prevent device startup.
						void localeRegistration
							.locale()
							.then(synchronizeKnobLocale, () => {});
						let managementReady = Promise.resolve();
						const focusManagement = (): void => {
							if (quitting) return;
							reopenWindows();
							const target = managementWin;
							void managementReady.then(() => {
								if (
									quitting ||
									target.isDestroyed() ||
									target !== managementWin
								)
									return;
								if (target.isMinimized()) target.restore();
								target.show();
								target.focus();
							});
						};
						app.on("second-instance", focusManagement);
						const profileUpdates = profiles.runtime.runFork(
							ProfileService.subscribeCommittedProfiles().pipe(
								Effect.flatMap((snapshots) =>
									Stream.runForEach(snapshots, () =>
										Effect.tryPromise({
											try: () => knob.refresh(),
											catch: KnobDispatchFailed.fromCause,
										}).pipe(
											Effect.catchTag("KnobDispatchFailed", (error) =>
												Effect.logWarning(
													"Refreshing knob profiles failed",
													error,
												),
											),
										),
									),
								),
							),
						);
						const source = mock
							? startMockHardwareBus(process.env.OPEN_QUAKE_E2E_RUN !== "1")
							: Effect.gen(function* () {
									const controls = yield* HardwareControls;
									return yield* startDeviceBus((connection) =>
										Effect.gen(function* () {
											const serial = connection.info.serialNumber;
											if (serial)
												yield* Effect.acquireRelease(
													Effect.sync(() => {
														activeSerial = serial;
													}),
													() =>
														Effect.promise(() =>
															voice.onDevice({
																source: "hid",
																kind: "status",
																state: "disconnected",
																reason: "scope-closed",
															}),
														).pipe(
															Effect.ensuring(
																Effect.sync(() => {
																	if (activeSerial === serial)
																		activeSerial = undefined;
																}),
															),
														),
												);
											if (serial)
												yield* Effect.acquireRelease(
													Effect.tryPromise(() =>
														profiles.connect(serial),
													).pipe(
														Effect.catchAll((error) =>
															Effect.logWarning(
																"Profile session enrollment failed",
																error,
															),
														),
													),
													() =>
														Effect.tryPromise(() =>
															profiles.disconnect(serial),
														).pipe(
															Effect.catchAll(() =>
																Effect.logWarning(
																	"Profile session cleanup failed",
																),
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
							rendererURL,
							diagnostics,
						);
						let running:
							| Fiber.RuntimeFiber<void, Effect.Effect.Error<typeof source>>
							| undefined;
						let stopping = Promise.resolve();
						let generation = 0;
						let quitting = false;
						let quitFinished = false;
						const lifecycle = lifecycleRuntime.runPromise(DeviceLifecycle);
						const removeLifecycle = registerLifecycle(
							lifecycleRuntime,
							() => managementWin,
							process.env.ELECTRON_RENDERER_URL ??
								pathToFileURL(
									join(import.meta.dirname, "../renderer/index.html"),
								).href,
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
														lifecycleRuntime.runPromise(
															service.onStatus(event),
														),
													);
													if (!mock)
														void resetKeysOnLinkLoss(
															event,
															profiles.resetKeys,
														).catch(() => {});
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
									try {
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
									} finally {
										try {
											await runtime.runPromise(Fiber.interrupt(fiber));
										} finally {
											bus = undefined;
										}
									}
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
								loadSurface(
									panelWin,
									"panel",
									panelRotation(panelTarget.display, panelTarget.isPanel),
								);
							} else if (panelTarget.isPanel !== previous.isPanel) {
								// The window type is fixed at creation; swap before closing the old one
								// so the bus never sees zero windows.
								const old = panelWin;
								panelWin = createPanelWindow(panelTarget);
								loadSurface(
									panelWin,
									"panel",
									panelRotation(panelTarget.display, panelTarget.isPanel),
								);
								old.destroy();
							} else {
								placePanel(panelWin, panelTarget);
								const rotation = panelRotation(
									panelTarget.display,
									panelTarget.isPanel,
								);
								if (
									rotation !== panelRotation(previous.display, previous.isPanel)
								)
									loadSurface(panelWin, "panel", rotation);
							}
							startBus();
						};
						const topologyChanged = (): void => {
							// Hide synchronously so an OS relocation cannot expose the strip on primary.
							if (
								panelTarget.isPanel &&
								!screen
									.getAllDisplays()
									.some((d) => d.id === panelTarget.display.id) &&
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
							removeKnobLocale();
							disposeHardware();
							ipcMain.removeListener(QUAKE_STATUS_CHANNEL, sendStatus);
							shutdown = (async () => {
								const failures: unknown[] = [];
								// Keep dependency order, but never skip the remaining cleanup after a failure.
								for (const stop of [
									() => stopBus(),
									() => weatherMedia.dispose(),
									() => meetings.dispose(),
									() => monitor.dispose(),
									() => lifecycleRuntime.dispose(),
									() =>
										profiles.runtime.runPromise(
											Fiber.interrupt(profileUpdates),
										),
									() => knob.dispose(),
									() => agents.dispose(),
									() => integrations.dispose(),
									() => emoji.dispose(),
									() => settingsWindow.dispose(),
									() => localeRegistration.dispose(),
									() => chatRegistration.dispose(),
									() => agentHttp?.dispose(),
									() => disposeUnavailableAgentConnections(),
									() => removeSpeechSettings(),
									() => voice.dispose(),
									() => directChat.dispose(),
									() => profiles.dispose(),
									() => clock.dispose(),
									() => media.dispose(),
									() => runtime.dispose(),
								]) {
									try {
										await stop();
									} catch (cause) {
										failures.push(cause);
									}
								}
								if (closeWindows) {
									if (!managementWin.isDestroyed()) {
										managementWin.webContents.session.flushStorageData();
										managementWin.destroy();
									}
									if (!panelWin.isDestroyed()) panelWin.destroy();
								}
								if (failures.length)
									throw new MaintenanceShutdownFailed(
										new AggregateError(failures),
									);
							})();
							return shutdown;
						};
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
									Effect.logError("Application shutdown failed", error).pipe(
										Effect.provide(diagnostics.layer),
									),
								);
							};
							void maintenance
								.dispose()
								.catch(reportFailure)
								.then(() =>
									background.runPromise(
										diagnostics.instrument(
											Effect.promise(() => stopWriters()),
											"app.shutdown",
										),
									),
								)
								.catch(reportFailure)
								.then(async () => {
									try {
										await background.dispose();
									} catch (cause) {
										reportFailure(cause);
									}
									try {
										await application.dispose();
									} catch (cause) {
										reportFailure(cause);
									} finally {
										try {
											await diagnostics.close();
										} finally {
											quitFinished = true;
											app.quit();
										}
									}
								});
						});

						const reopenWindows = (): void => {
							if (quitting) return;
							if (managementWin.isDestroyed()) {
								if (panelWin.isDestroyed())
									syncPanelDisplay(findPanelDisplay(screen.getAllDisplays()));
								managementWin = createManagementWindow();
								loadSurface(managementWin, "management");
								managementReady = settingsWindow.initialize(
									managementWin,
									false,
								);
								startBus();
								// stopBus locks the lifecycle before releasing the old owner.
								// Unlock only after that stop completes, including rapid reopening.
								void stopping.then(() => {
									if (!quitting && BrowserWindow.getAllWindows().length > 0)
										onWake();
								});
							}
						};
						app.on("activate", focusManagement);
						app.on("window-all-closed", () => {
							void stopBus();
							if (process.platform !== "darwin") app.quit();
						});
						loadSurface(
							panelWin,
							"panel",
							panelRotation(panelTarget.display, panelTarget.isPanel),
						);
						loadSurface(managementWin, "management");
						managementReady = settingsWindow.initialize(managementWin);
						await managementReady;
					}),
					"app.startup",
				)
				.pipe(Effect.provide(diagnostics.layer)),
		);
	});

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
	powerSaveBlocker,
	screen,
	shell,
} from "electron";
import { KnobDispatchFailed } from "../../../../packages/device/src/knob/knob-errors.js";
import { ProfileManager } from "../../../../packages/device/src/profiles/profile-manager-service.js";
import { ProfileRepository } from "../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileService } from "../../../../packages/device/src/profiles/profile-service.js";
import { AgentsService } from "../../../../packages/edge/src/agents/agents-service";
import { AiConfigInvalid } from "../../../../packages/edge/src/ai/ai-errors";
import { MaintenanceShutdownFailed } from "../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type { LocaleSnapshot } from "../../../../packages/edge/src/settings/settings-contracts";
import { VoiceKnobRejected } from "../../../../packages/edge/src/voice/surface/voice-surface-errors";
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
import { findPanelDisplay, type PanelRotation, panelRotation } from "./display";
import { prepareEmoji } from "./emoji";
import { createEmojiGeneration } from "./emoji/generation";
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
import { pinKnobProfile } from "./knob/voice-route";
import { arrangementState } from "./lifecycle/arrangement-state";
import { DeviceLifecycle } from "./lifecycle/lifecycle-service";
import {
	callDisplayTool,
	DisplayOperationFailed,
	extendWindowsDisplays,
	farRightOrigins,
	probeHiddenMirroring,
	probeWindowsDisplays,
} from "./lifecycle/native-display";
import {
	createPanelWindow,
	destroyPanel,
	type PanelTarget,
	parkPanel,
	placePanel,
	showPanel,
} from "./lifecycle/panel-window";
import { makePowerOwner } from "./lifecycle/power-owner";
import { registerLifecycle } from "./lifecycle/registration";
import { prepareMaintenance } from "./maintenance";
import {
	readNativeTheme,
	registerManagementAppearance,
} from "./management/appearance";
import { MediaLive, registerMedia } from "./media";
import { prepareMeetings } from "./meetings";
import { prepareMonitor } from "./monitor";
import { activeMonitorKey } from "./monitor/panel-media";
import { prepareObs } from "./obs";
import { obsKeyAction } from "./obs/key-action";
import { visibleObsKeys } from "./obs/visibility";
import { prepareProfiles } from "./profiles";
import { activeClockTarget } from "./profiles/clock-profile-binding";
import { createSettingsOsAdapter } from "./settings/os-adapter";
import { prepareAppLocale } from "./settings/registration";
import { bindSettingsWindow } from "./settings/window-binding";
import { createWizardOwners } from "./settings/wizard-owners";
import { emptySpeechSettings, registerSpeechSettings } from "./speech";
import { createSpeechVoiceBinding } from "./speech/composition";
import { createToneRecorder, prepareVoiceSurface, toneSinks } from "./voice";
import { registerWeatherMedia, weatherMediaLive } from "./weather-media";
import { HostVolume } from "./weather-media/host-volume";
import {
	isSystemPlayerKey,
	systemMediaKeyActions,
} from "./weather-media/key-actions";
import { committedLocalPlayer } from "./weather-media/local-player";
import { SystemMediaService } from "./weather-media/system-media";

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL;
const rendererURL =
	isDev && process.env.ELECTRON_RENDERER_URL
		? process.env.ELECTRON_RENDERER_URL
		: pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
registerClockScheme();

function loadSurface(
	win: BrowserWindow,
	surface: "management" | "panel",
	rotation: PanelRotation = 0,
	serial?: string,
): void {
	const query = {
		surface,
		rotation: String(rotation),
		...(serial ? { serial } : {}),
	};
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
						let panelWin = createPanelWindow(panelTarget, isDev);
						const stripWindows = new Map<
							string,
							{ win: BrowserWindow; target: PanelTarget }
						>();
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
							weatherMediaLive(
								app.getPath("userData"),
								process.platform,
								committedLocalPlayer(
									(signal) =>
										profilesModule.runtime
											.runPromise(ProfileService.loadProfiles(), { signal })
											.then((result) => result.envelope),
									(key, target) => speech.readSoundKey(key, target),
								),
							),
							(runtime) => registerWeatherMedia(runtime, () => managementWin),
							diagnostics,
						);
						const mediaActions = systemMediaKeyActions(
							(command, signal) =>
								weatherModule.runtime.runPromise(
									command === "audio_mute" ||
										command === "audio_vol_down" ||
										command === "audio_vol_up"
										? HostVolume.command(command).pipe(
												Effect.as({ accepted: true as boolean }),
											)
										: SystemMediaService.send(command),
									{ signal },
								),
							(listener) => {
								let disposed = false;
								let off: (() => void) | undefined;
								void weatherModule.runtime
									.runPromise(HostVolume)
									.then((owner) => {
										if (!disposed) off = owner.observe(listener);
									});
								return () => {
									disposed = true;
									off?.();
								};
							},
						);
						let bus: DeviceBus | undefined;
						let activeSerial: string | undefined;
						const connectedSerials = new Set<string>();
						const activeDeviceId = () => activeSerial ?? "desktop-preview";
						const panelSerial = (
							sender: Electron.WebContents,
						): string | undefined =>
							[...stripWindows.entries()].find(
								([, entry]) =>
									!entry.win.isDestroyed() && entry.win.webContents === sender,
							)?.[0];
						const currentHardware = () =>
							bus?.device
								? bus.device(activeDeviceId())?.hardware?.()
								: bus?.hardware?.();
						const hardwareSessions = () =>
							bus?.device
								? [...connectedSerials].flatMap((serial) => {
										const session = bus?.device?.(serial)?.hardware?.();
										return session ? [session] : [];
									})
								: currentHardware()
									? [currentHardware()].filter((s) => s !== undefined)
									: [];
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
										const hardware = currentHardware();
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
								localResume: fileStore(
									app.getPath("userData"),
									"local-player-resume-v1.json",
									{},
								),
								storage: fileStore(
									app.getPath("userData"),
									"speech-v1.json",
									emptySpeechSettings,
								),
								credentials: systemCredentialVault(
									join(app.getPath("userData"), "credentials"),
								),
								diagnostics,
								pinDirectModel: (snapshot) =>
									Effect.tryPromise({
										try: () =>
											profiles.runtime.runPromise(
												ProfileService.getProfile(snapshot.profileId),
											),
										catch: (cause) =>
											new VoiceKnobRejected("RouteIncomplete", cause),
									}).pipe(
										Effect.zipRight(
											directChat.pinKnobModel(
												snapshot.providerId,
												snapshot.modelId,
											),
										),
									),
							},
							http: httpModule.createVoiceAdapter,
							run: (effect) => background.runPromise(effect),
						});
						const voiceModule = prepareVoiceSurface({
							diagnostics,
							runtime: speech.decorate,
							knobRoute: (serial) =>
								Effect.tryPromise({
									try: () =>
										profiles.runtime.runPromise(ProfileService.loadProfiles()),
									catch: (cause) =>
										new VoiceKnobRejected("RouteIncomplete", cause),
								}).pipe(
									Effect.flatMap(({ envelope }) =>
										pinKnobProfile(envelope, serial),
									),
								),
							speech,
							mock: process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
							tones: toneSinks(createToneRecorder(), {
								play: (serial, tone) => {
									const hardware = bus?.device
										? bus.device(serial)?.hardware?.()
										: currentHardware();
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
							currentHardware,
							() => panelWin,
							async (key, signal, activation) =>
								(await obsKeyAction((command, signal) =>
									obs.execute(command, signal),
								)(key, signal)) ||
								(await speech.executeSoundKey(key, signal, activation)) ||
								(isSystemPlayerKey(key)
									? await weatherModule.runtime
											.runPromise(SystemMediaService.control("toggle"), {
												signal,
											})
											.then((result) => result.accepted)
									: false) ||
								integrationKeyAction((key, signal) =>
									integrations.executeHaFromKey(key, signal),
								)(key, signal),
							diagnostics,
							mediaActions,
							speech.resetSoundKeys,
							panelSerial,
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
						const obsModule = prepareObs({
							renderer: rendererURL,
							management: () => managementWin,
							panel: () => panelWin,
							visibleKeys: () =>
								profilesModule.runtime.runPromise(
									ProfileService.loadProfiles().pipe(
										Effect.map(({ envelope }) =>
											visibleObsKeys(envelope, activeDeviceId()),
										),
									),
								),
							diagnostics,
							mock: process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
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
							generation: createEmojiGeneration({
								models: () =>
									agentsModule.runtime.runPromise(
										AgentsService.resolve("default"),
									),
								credentials: modelCredentials.ai,
								infer: (effect, signal) =>
									directModule.runtime.runPromise(effect, { signal }),
							}),
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
								readVolume: Effect.tryPromise({
									try: (signal) =>
										weatherModule.runtime.runPromise(HostVolume.read, {
											signal,
										}),
									catch: KnobDispatchFailed.fromCause,
								}),
								writeVolume: (reading) =>
									Effect.tryPromise({
										try: (signal) =>
											weatherModule.runtime.runPromise(
												HostVolume.write(reading),
												{ signal },
											),
										catch: KnobDispatchFailed.fromCause,
									}),
								deviceId: activeDeviceId,
								locale: () => knobLocale,
								profiles: knobProfileBinding(
									profilesModule.runtime,
									(...args) => profiles.select(...args),
								),
								thumbnail: (...args) => profiles.thumbnail(...args),
								obs: (key, delta, signal, beforeWrite) =>
									obs.turn(key, delta, signal, beforeWrite),
								hardware: currentHardware,
								voice: (...args) => voice.knobVoice(...args),
							},
							diagnostics,
						);
						const mediaModule = prepareDesktopModule(
							MediaLive(join(app.getPath("userData"), "wallpaper-v1")),
							(runtime) =>
								registerMedia(
									runtime,
									() => managementWin,
									rendererURL,
									false,
									() => panelWin,
									speech.acquireWallpaperSound,
									panelSerial,
								),
							diagnostics,
						);
						const clockModule = prepareDesktopModule(
							ClockLive(app.getPath("userData"), profilesModule.runtime),
							(runtime) =>
								registerClock(runtime, () => managementWin, undefined, {
									panel: () => panelWin,
									target: async (keyCode) => {
										const { envelope } =
											await profilesModule.runtime.runPromise(
												ProfileRepository.load(),
											);
										return activeClockTarget(
											envelope,
											activeDeviceId(),
											keyCode,
										);
									},
								}),
							diagnostics,
						);
						const monitorModule = prepareMonitor(
							app.getPath("userData"),
							() => managementWin,
							() => panelWin,
							undefined,
							rendererURL,
							diagnostics,
							async (keyCode) => {
								const { envelope } = await profilesModule.runtime.runPromise(
									ProfileRepository.load(),
								);
								return activeMonitorKey(envelope, activeDeviceId(), keyCode);
							},
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
							microphone: speech.settings.microphone,
							diagnostics,
							userData: app.getPath("userData"),
							hardware: currentHardware,
							mock,
							serial: activeDeviceId,
							publishVoice: (event) => publishVoice(event),
						});
						const panelPower = makePowerOwner(powerSaveBlocker);
						const lifecycleModule = prepareDesktopModule(
							DeviceLifecycle.Default({
								mock,
								development: isDev,
								activeCount: (count) =>
									panelPower
										.setCount(count)
										.pipe(
											Effect.catchTag("DisplayOperationFailed", (error) =>
												Effect.logWarning(error),
											),
										),
								disposePanel: (serial) => {
									const owned = serial ? stripWindows.get(serial) : undefined;
									if (owned) {
										destroyPanel(owned.win);
										stripWindows.delete(serial ?? "");
										if (
											panelWin === owned.win ||
											panelWin.isDestroyed() ||
											!activeSerial
										) {
											const remaining = [...stripWindows.entries()].find(
												([id, entry]) =>
													connectedSerials.has(id) && !entry.win.isDestroyed(),
											);
											if (remaining) {
												activeSerial = remaining[0];
												panelWin = remaining[1].win;
												panelTarget = remaining[1].target;
											}
										}
									} else if (!stripWindows.size) destroyPanel(panelWin);
								},
								displays: () => screen.getAllDisplays(),
								bus: () => bus,
								busFor: (serial) => bus?.device?.(serial) ?? bus,
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
								panel: (
									display,
									visible,
									fallback,
									serial = activeDeviceId(),
								) => {
									const owned = stripWindows.get(serial);
									if (!visible) {
										if (owned) parkPanel(owned.win);
										else if (!stripWindows.size && !panelWin.isDestroyed())
											parkPanel(panelWin);
										return;
									}
									if (display || fallback) syncPanelDisplay(display, serial);
									const win = stripWindows.get(serial)?.win;
									if (win && !win.isDestroyed()) showPanel(win);
								},
								alert: (serial, alert) => {
									const win = stripWindows.get(serial)?.win;
									if (win && !win.isDestroyed())
										win.webContents.send("quake:lifecycle-alert", alert);
								},
								notify: (status) => {
									if (!managementWin.isDestroyed())
										managementWin.webContents.send(LIFECYCLE_STATUS, status);
									if (status.alert)
										for (const { win } of stripWindows.values())
											if (!win.isDestroyed())
												win.webContents.send(LIFECYCLE_STATUS, status);
								},
								prompts: {
									disconnect: () => Effect.sync(() => app.quit()),
									arrangement: arrangementState(
										join(
											app.getPath("userData"),
											"display-arrangement-v1.json",
										),
									),
									windowsProbe: () =>
										mock || process.platform !== "win32"
											? Effect.succeed({
													source: "none",
													present: false,
													width: 0,
													height: 0,
													failed: false,
												})
											: probeWindowsDisplays(),
									windowsExtend: () =>
										mock || process.platform !== "win32"
											? Effect.void
											: extendWindowsDisplays(),
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
							hardware: currentHardware,
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
							obsModule.layer,
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
						obsModule.bind(application);
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
						const obs = obsModule.start();
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
									Stream.runForEach(snapshots, (envelope) =>
										Effect.tryPromise({
											try: async () => {
												await speech.reconcileProfiles(
													envelope.profiles.map((p) => p.id),
												);
												await knob.refresh();
											},
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
														connectedSerials.add(serial);
														activeSerial ??= serial;
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
																	connectedSerials.delete(serial);
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
							currentHardware,
							() => managementWin,
							mock,
							rendererURL,
							diagnostics,
							hardwareSessions,
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
						let screenLocked = false;
						const onLock = (): void => {
							screenLocked = true;
							void lifecycle.then((service) =>
								lifecycleRuntime.runPromise(service.lock()),
							);
						};
						const onWake = (): void => {
							screenLocked = false;
							void lifecycle.then((service) =>
								lifecycleRuntime.runPromise(service.wake()),
							);
						};
						powerMonitor.on("lock-screen", onLock);
						powerMonitor.on("unlock-screen", onWake);
						const onResume = (): void => {
							const sessions = screenLocked ? [] : hardwareSessions();
							for (const session of sessions)
								void runtime.runPromise(
									session
										.setLocked(false)
										.pipe(Effect.catchAll((error) => Effect.logWarning(error))),
								);
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
											if (bus.onLifecycleStatus) {
												const off = bus.onLifecycleStatus((event, serial) => {
													void lifecycle.then((service) =>
														lifecycleRuntime.runPromise(
															service.onStatus(event, serial),
														),
													);
												});
												yield* Effect.addFinalizer(() => Effect.sync(off));
											}
											const owner = bus;
											let input = Promise.resolve();
											bus.on(
												(
													event,
													serial = owner.serial?.() ?? activeDeviceId(),
												) => {
													// Gate new holds synchronously and cancel in main before
													// renderer touch teardown can synthesize a normal release.
													if (event.kind === "status")
														void voice.onDevice(event);
													const target =
														stripWindows.get(serial)?.win ??
														(serial === (owner.serial?.() ?? activeDeviceId())
															? panelWin
															: undefined);
													createEventForwarder(
														() =>
															target
																? [target, managementWin]
																: [managementWin],
														() => (target ? [target] : []),
													)(event);
													if (event.kind !== "keepalive") {
														input = input
															.then(async () => {
																if (bus !== owner) return;
																const changed = activeDeviceId() !== serial;
																if (
																	event.kind !== "status" ||
																	event.state === "connected"
																) {
																	activeSerial = serial;
																	const owned = stripWindows.get(serial);
																	if (owned) {
																		panelWin = owned.win;
																		panelTarget = owned.target;
																	}
																	if (changed) await knob.refresh();
																}
																if (event.kind !== "status")
																	await voice.onDevice(event);
																await knob.onDevice(event);
															})
															.catch(() => {});
													}
													if (event.kind === "status") {
														if (!bus?.onLifecycleStatus)
															void lifecycle.then((service) =>
																lifecycleRuntime.runPromise(
																	service.onStatus(event, serial),
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
												},
											);
											yield* Effect.addFinalizer(() =>
												Effect.promise(() => input),
											);
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
						const syncPanelDisplay = (
							display?: Display,
							serial = activeDeviceId(),
						): void => {
							const owned = stripWindows.get(serial);
							const previous = owned?.target ?? panelTarget;
							const target: PanelTarget = display
								? { display, isPanel: true }
								: { display: screen.getPrimaryDisplay(), isPanel: false };
							let win =
								owned?.win ?? (stripWindows.size === 0 ? panelWin : undefined);
							if (
								!win ||
								win.isDestroyed() ||
								target.isPanel !== previous.isPanel
							) {
								const old = win;
								win = createPanelWindow(target, isDev);
								loadSurface(
									win,
									"panel",
									panelRotation(target.display, target.isPanel),
									serial,
								);
								if (old && !old.isDestroyed()) destroyPanel(old);
							} else {
								placePanel(win, target);
								if (
									!owned ||
									panelRotation(target.display, target.isPanel) !==
										panelRotation(previous.display, previous.isPanel)
								)
									loadSurface(
										win,
										"panel",
										panelRotation(target.display, target.isPanel),
										serial,
									);
							}
							stripWindows.set(serial, { win, target });
							if (serial === activeDeviceId() || stripWindows.size === 1) {
								panelWin = win;
								panelTarget = target;
							}
							startBus();
						};
						const topologyChanged = (
							_event?: unknown,
							_display?: Display,
							metrics?: string[],
						): void => {
							// Hide synchronously so an OS relocation cannot expose any serial's strip on primary.
							let lostStrip = false;
							for (const { win, target } of stripWindows.values())
								if (
									target.isPanel &&
									!screen
										.getAllDisplays()
										.some((d) => d.id === target.display.id) &&
									!win.isDestroyed()
								) {
									parkPanel(win);
									lostStrip = true;
								}
							if (lostStrip) {
								void voice.reset();
								void profiles.resetKeys().catch(() => {});
							}

							void lifecycle.then((service) =>
								lifecycleRuntime.runPromise(service.topology(metrics)),
							);
						};
						screen.on("display-added", topologyChanged);
						screen.on("display-removed", topologyChanged);
						screen.on("display-metrics-changed", topologyChanged);

						startBus();
						// Preload asks after registering its listener, including after reloads.
						const sendStatus = (event: Electron.IpcMainEvent): void => {
							const serial = panelSerial(event.sender);
							const status = (
								serial && serial !== "desktop-preview" && bus?.device
									? bus.device(serial)
									: bus
							)?.currentStatus();
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
									// Bus teardown joins input work owned by the knob registration.
									// Cancel its loads/dispatches before waiting for that queue.
									() => knob.dispose(),
									() => stopBus(),
									() => weatherMedia.dispose(),
									() => meetings.dispose(),
									() => monitor.dispose(),
									() => lifecycleRuntime.dispose(),
									() =>
										profiles.runtime.runPromise(
											Fiber.interrupt(profileUpdates),
										),
									() => agents.dispose(),
									() => integrations.dispose(),
									() => obs.dispose(),
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
									for (const owned of stripWindows.values())
										destroyPanel(owned.win);
									if (!panelWin.isDestroyed()) destroyPanel(panelWin);
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
								removeLifecycle.bindManagement();
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

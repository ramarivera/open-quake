import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HardwareSession } from "@open-quake/device";
import { Effect, Exit, Layer, Schema } from "effect";
import { app, type BrowserWindow, dialog, ipcMain, shell } from "electron";
import {
	FirmwarePort,
	FirmwareUpdates,
} from "../../../../../packages/edge/src/maintenance/firmware-service.js";
import {
	BackupFailed,
	FirmwarePersistenceFailed,
	FirmwareTargetMismatch,
	FirmwareUnavailable,
	MaintenanceShutdownFailed,
	ResetFailed,
	RestoreFailed,
} from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import {
	DataReset,
	ResetPort,
} from "../../../../../packages/edge/src/maintenance/reset-service.js";
import {
	AppUpdatePort,
	AppUpdates,
} from "../../../../../packages/edge/src/maintenance/update-service.js";
import { APPEARANCE_STORAGE_KEY } from "../../renderer/src/theme/appearance";
import {
	FIRMWARE_PROGRESS_CHANNEL,
	MAINTENANCE_CHANNEL,
	MaintenanceCommand,
	type MaintenanceReply,
	type MaintenanceView,
	runningFirmware,
} from "../../shared/maintenance-contracts";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { canRequestWallpaper } from "../media/media-permissions";
import { type OwnedUpdateConfiguration, ownedAppUpdater } from "./app-updater";
import {
	acknowledgeAppearance,
	appearanceRecord,
	pendingAppearance,
} from "./appearance-backup";
import { clearOwnedData, exportBackup, prepareRestore } from "./backup-store";
import { replaceBackup } from "./backup-write";
import {
	atomicJson,
	firmwareFiles,
	type TrustedFirmware,
} from "./firmware-files";
import { firmwareSessionStore } from "./firmware-session";
import { firmwareVersions } from "./firmware-versions";
import { githubAppImageConfiguration, RELEASES_PAGE } from "./github-releases";
import {
	nativePermissionChecks,
	nativePermissionRequest,
	openPermission,
	type PermissionChecks,
	permissionAction,
	permissionRows,
} from "./permissions";
import { resetAndExit } from "./reset-exit";
import { restoreAndExit } from "./restore-exit";
import { windowsDfuDiscovery } from "./volume-discovery";

export function maintenanceRequestAllowed(
	caller: string,
	renderer: string,
	mainFrame: boolean,
	management: boolean,
	input: unknown,
): boolean {
	return (
		mainFrame &&
		management &&
		canRequestWallpaper(caller, renderer, input, true) &&
		Schema.is(MaintenanceCommand)(input)
	);
}
interface MaintenanceOptions {
	readonly updater?: OwnedUpdateConfiguration;
	readonly diagnostics?: DesktopDiagnostics;
	readonly root: string;
	readonly mock: boolean;
	readonly renderer: string;
	readonly hardware: () => HardwareSession | undefined;
	readonly management: () => BrowserWindow | undefined;
	readonly stopWriters: () => Promise<void>;
	readonly permissionFlow?: () => () => void;
	readonly exit?: (code?: number) => void | Promise<void>;
	readonly fixture?: {
		readonly bundledDirectories?: readonly string[];
		readonly roots: readonly string[];
		readonly descriptors: readonly TrustedFirmware[];
	};
}
export function prepareMaintenance(options: MaintenanceOptions) {
	const { root, mock } = options;
	const nativeExit = options.exit ?? ((code = 0) => app.exit(code));
	let requestedExit: number | undefined;
	let replacement: (() => Promise<void>) | undefined;
	let exitStarted = false;
	// Complete the effect and its diagnostic span before the forced native exit.
	const exit = (code = 0): void => {
		requestedExit = code;
		disposed = true;
	};
	const mockRoot = join(root, "firmware-mock");
	const roots =
		options.fixture?.roots ??
		(mock
			? [mockRoot]
			: process.platform === "darwin"
				? ["/Volumes"]
				: process.platform === "linux"
					? [
							`/media/${process.env.USER ?? ""}`,
							`/run/media/${process.env.USER ?? ""}`,
						]
					: []);
	const files = firmwareFiles(
		roots,
		options.fixture?.descriptors,
		!mock && process.platform === "win32" ? windowsDfuDiscovery() : undefined,
	);
	let checks: PermissionChecks | undefined;
	let mutating = false;
	let pendingOperations = 0;
	let disposed = false;
	let mockVersion = "1.0.19";
	const versions = firmwareVersions();
	const sessions = firmwareSessionStore(
		join(root, "firmware-session-v1.json"),
		options.diagnostics,
	);
	const bookmarkReleases = new Set<() => void>();
	const releaseBookmarks = () => {
		for (const release of [...bookmarkReleases]) release();
	};
	const trackBookmark = (release: () => void) => {
		const stop = () => {
			if (bookmarkReleases.delete(stop)) release();
		};
		bookmarkReleases.add(stop);
		return stop;
	};
	const version = (serial: string) =>
		Effect.gen(function* () {
			const current = options.hardware();
			if (!current) return yield* new FirmwareUnavailable();
			const snapshot = yield* current.snapshot();
			if (snapshot.serial !== serial || !snapshot.available)
				return yield* new FirmwareUnavailable();
			const reported = mock
				? mockVersion
				: yield* current
						.readVersion()
						.pipe(Effect.mapError((cause) => new FirmwareUnavailable(cause)));
			versions.readback(serial, reported, snapshot.session);
			return reported;
		});
	const confirm = async (message: string, detail = ""): Promise<boolean> => {
		const parent = options.management();
		const config = {
			type: "warning" as const,
			message,
			detail,
			buttons: ["Cancel", "Continue"],
			defaultId: 0,
			cancelId: 0,
			noLink: true,
		};
		return (
			(parent && !parent.isDestroyed()
				? await dialog.showMessageBox(parent, config)
				: await dialog.showMessageBox(config)
			).response === 1
		);
	};
	const doExport = Effect.fn("DesktopBackup.export")(
		function* (): Effect.fn.Return<boolean, BackupFailed> {
			return yield* Effect.tryPromise({
				try: async (signal) => {
					const parent = options.management();
					const config = {
						title: "Export",
						defaultPath: join(
							app.getPath("downloads"),
							`DK-Suite_default_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_export_resources.zip`,
						),
						filters: [{ name: "Encrypted ZIP backup", extensions: ["zip"] }],
					};
					const selected = parent
						? await dialog.showSaveDialog(parent, config)
						: await dialog.showSaveDialog(config);
					if (selected.canceled || !selected.filePath || signal.aborted)
						return false;
					if (
						!parent ||
						parent.isDestroyed() ||
						!canRequestWallpaper(
							parent.webContents.getURL(),
							options.renderer,
							{ _tag: "read" },
							true,
						)
					)
						throw new BackupFailed();
					const appearance = appearanceRecord(
						await parent.webContents.executeJavaScript(
							`localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)})`,
						),
					);
					const bytes = await exportBackup(root, signal, appearance);
					if (signal.aborted) return false;
					await replaceBackup(selected.filePath, bytes, signal);
					shell.showItemInFolder(selected.filePath);
					return true;
				},
				catch: (cause) => new BackupFailed(cause),
			});
		},
	);

	const prepared = prepareDesktopModule(
		Layer.mergeAll(
			FirmwareUpdates.Default.pipe(
				Layer.provide(
					Layer.scoped(
						FirmwarePort,
						Effect.acquireRelease(
							Effect.succeed({
								publish: (snapshot) => {
									const window = options.management();
									if (
										window &&
										!window.isDestroyed() &&
										canRequestWallpaper(
											window.webContents.getURL(),
											options.renderer,
											{ _tag: "read" },
											true,
										)
									)
										window.webContents.send(
											FIRMWARE_PROGRESS_CHANNEL,
											snapshot,
										);
								},
								current: () =>
									Effect.gen(function* () {
										const current = options.hardware();
										if (!current) return yield* new FirmwareUnavailable();
										const snapshot = yield* current.snapshot();
										return {
											serial: snapshot.serial,
											session: snapshot.session,
											version: yield* version(snapshot.serial),
										};
									}),
								version,
								image: files.selected,
								enter: (serial, session) =>
									Effect.gen(function* () {
										const current = options.hardware();
										if (!current) return yield* new FirmwareUnavailable();
										const snapshot = yield* current.snapshot();
										if (
											snapshot.serial !== serial ||
											snapshot.session !== session ||
											!snapshot.available
										)
											return yield* new FirmwareUnavailable();
										if (mock) {
											yield* Effect.tryPromise({
												try: async () => {
													await mkdir(join(mockRoot, "QUAKE DFU"), {
														recursive: true,
													});
													await writeFile(
														join(mockRoot, "QUAKE DFU", "INFO_UF2.TXT"),
														"UF2 Bootloader\nBoard-ID: QUAKE RP2040\n",
													);
												},
												catch: (cause) => new FirmwareUnavailable(cause),
											});
											return;
										}
										yield* current
											.enterDfu()
											.pipe(
												Effect.mapError(
													(cause) => new FirmwareUnavailable(cause),
												),
											);
									}),
								volumes: files.discover,
								copy: (image, volume, progress) =>
									files.copy(image, volume, progress).pipe(
										// A native copy cannot be cancelled safely; await it before releasing access.
										Effect.uninterruptible,
										Effect.tap(() =>
											Effect.sync(() => {
												if (mock) mockVersion = image.version;
											}),
										),
										Effect.ensuring(Effect.sync(releaseBookmarks)),
									),
								load: () =>
									Effect.tryPromise({
										try: sessions.load,
										catch: (cause) => new FirmwarePersistenceFailed(cause),
									}),
								save: (snapshot) =>
									Effect.tryPromise({
										try: () => sessions.save(snapshot),
										catch: (cause) => new FirmwarePersistenceFailed(cause),
									}).pipe(Effect.uninterruptible),
							}),
							() => Effect.sync(releaseBookmarks),
						),
					),
				),
			),
			AppUpdates.Default.pipe(
				Layer.provide(
					Layer.succeed(
						AppUpdatePort,
						ownedAppUpdater({
							root: join(root, "app-updates"),
							currentVersion: app.getVersion(),
							platform: process.platform,
							arch: process.arch,
							...(options.updater
								? { configuration: options.updater }
								: !mock &&
										app.isPackaged &&
										process.platform === "linux" &&
										process.env.APPIMAGE
									? {
											configuration: githubAppImageConfiguration({
												arch: process.arch,
												image: process.env.APPIMAGE,
												restart: () => {
													app.relaunch({
														execPath: process.env.APPIMAGE ?? process.execPath,
													});
													app.quit();
												},
											}),
										}
									: {}),
						}),
					),
				),
			),
			DataReset.Default.pipe(
				Layer.provide(
					Layer.succeed(ResetPort, {
						backup: doExport,
						confirmFailure: () =>
							Effect.tryPromise({
								try: () =>
									confirm("Backup failed. Continue to clear data and exit?"),
								catch: (cause) => new ResetFailed(cause),
							}),
						resetAndQuit: () =>
							Effect.sync(() => {
								replacement = () =>
									resetAndExit({
										stop: async () => {
											disposed = true;
											await options.stopWriters();
										},
										clear: () => clearOwnedData(root),
										report: (message) =>
											dialog.showMessageBox({ message, buttons: ["Close"] }),
										exit,
									});
							}),
					}),
				),
			),
		),
		(runtime) => {
			const ready = runtime.runPromise(
				Effect.gen(function* () {
					const firmware = yield* FirmwareUpdates;
					yield* firmware.snapshot();
					if (!mock || options.fixture?.bundledDirectories)
						yield* files.bundled(
							options.fixture?.bundledDirectories ??
								(options.fixture
									? []
									: [
											join(process.resourcesPath, "firmware"),
											join(process.resourcesPath, "app", "firmware"),
											join(app.getAppPath(), "firmware"),
											...(!app.isPackaged
												? [join(app.getAppPath(), "public", "firmware")]
												: []),
										]),
						);
					yield* AppUpdates;
					yield* DataReset;
				}),
			);
			// Observe initialization immediately, while retaining the rejecting promise for callers and disposal.
			void ready.catch((cause) => {
				const error = new FirmwarePersistenceFailed(cause);
				const log = Effect.logError("Maintenance initialization failed", error);
				Effect.runSync(
					options.diagnostics
						? options.diagnostics
								.instrument(log, "app.background")
								.pipe(Effect.provide(options.diagnostics.layer))
						: log,
				);
			});

			const view = Effect.fn("DesktopMaintenance.view")(
				function* (): Effect.fn.Return<
					MaintenanceView,
					FirmwarePersistenceFailed,
					FirmwareUpdates | AppUpdates
				> {
					const firmware = yield* FirmwareUpdates;
					const update = yield* AppUpdates;
					const current = options.hardware();
					const snapshot = current ? yield* current.snapshot() : undefined;
					const image = yield* files
						.selected()
						.pipe(
							Effect.catchTag("FirmwareTargetMismatch", () =>
								Effect.succeed(undefined),
							),
						);
					const serial = snapshot?.available ? snapshot.serial : "";
					const reported = !serial
						? ""
						: mock
							? mockVersion
							: snapshot?.firmware
								? `${snapshot.firmware.major}.${snapshot.firmware.minor}.${snapshot.firmware.patch}`
								: "";
					return {
						firmware: yield* firmware.snapshot(),
						...versions.observe(
							serial,
							reported,
							image,
							snapshot?.session ?? "",
						),
						imageVersion: image?.version ?? "",
						imageTrusted: image?.trusted ?? false,
						permissions: checks ? permissionRows(checks) : [],
						macOS: process.platform === "darwin",
						appVersion: app.getVersion(),
						update: yield* update.snapshot(),
					};
				},
			);
			const request = async (
				input: MaintenanceCommand,
			): Promise<MaintenanceReply> => {
				if (disposed) return { ok: false, code: "QUAKE.SETTINGS.STOPPING" };
				try {
					await ready;
				} catch {
					return { ok: false, code: new FirmwarePersistenceFailed().code };
				}
				if (disposed) return { ok: false, code: "QUAKE.SETTINGS.STOPPING" };
				const mutation = ![
					"read",
					"appearance-read",
					"appearance-applied",
				].includes(input.action);
				if (mutation && mutating)
					return { ok: false, code: "QUAKE.SETTINGS.BUSY" };
				if (mutation) mutating = true;
				pendingOperations++;
				try {
					let reply: MaintenanceReply = await runtime.runPromise(
						Effect.gen(function* () {
							const firmware = yield* FirmwareUpdates;
							const update = yield* AppUpdates;
							let message = "";
							let appearance: string | undefined;
							if (!checks && process.platform === "darwin")
								checks = mock
									? {
											accessibility: () => true,
											inputMonitoring: () => false,
											microphone: () => true,
											screenRecording: () => false,
											systemAudio: () => undefined,
										}
									: yield* Effect.promise(nativePermissionChecks);
							const io = <A>(f: () => Promise<A>) =>
								Effect.tryPromise({
									try: f,
									catch: (cause) =>
										cause instanceof RestoreFailed
											? cause
											: new RestoreFailed(cause),
								});
							switch (input.action) {
								case "appearance-read":
									appearance = yield* io(() => pendingAppearance(root));
									break;
								case "appearance-applied":
									yield* io(() => acknowledgeAppearance(root, input.record));
									break;
								case "read":
									break;
								case "firmware-inspect": {
									if (runningFirmware(yield* firmware.snapshot()))
										return yield* new FirmwareTargetMismatch();
									const selected = yield* io(() =>
										dialog.showOpenDialog({
											title: "Select firmware",
											filters: [{ name: "UF2 firmware", extensions: ["uf2"] }],
											properties: ["openFile"],
										}),
									);
									if (!selected.canceled && selected.filePaths[0])
										yield* files.inspect(selected.filePaths[0]);
									break;
								}
								case "firmware-start": {
									const current = options.hardware();
									if (!current) return yield* new FirmwareUnavailable();
									const selected = yield* current.snapshot();
									if (
										yield* io(() =>
											confirm(
												"Enter download mode?",
												"The selected QUAKE will disconnect. A separate confirmation is required before writing firmware.",
											),
										)
									)
										yield* firmware.start({
											serial: selected.serial,
											session: selected.session,
										});
									break;
								}
								case "firmware-recover": {
									if (
										yield* io(() =>
											confirm(
												"Recover QUAKE already in download mode?",
												`Intended device serial: ${input.serial}. Manually enter its bootloader and select its QUAKE DFU volume. A separate confirmation is required before writing; only a fresh version read from this serial can complete recovery.`,
											),
										)
									)
										yield* firmware.recover(input.serial);
									break;
								}
								case "firmware-write": {
									const intended = yield* firmware.snapshot();
									const path = files.pathFor(input.volumeId);
									if (!path) return yield* new FirmwareTargetMismatch();
									if (
										!(yield* io(() =>
											confirm(
												"Write firmware?",
												`Selected boot drive: ${path}. Intended device serial: ${intended.serial}. Do not disconnect the USB cable or turn off the device. Writing cannot be undone.`,
											),
										))
									)
										break;
									let stopAccess: (() => void) | undefined;
									yield* Effect.gen(function* () {
										if (!mock && process.platform === "darwin") {
											const selected = yield* io(() =>
												dialog.showOpenDialog({
													title: "Select the QUAKE DFU drive",
													properties: ["openDirectory"],
													securityScopedBookmarks: true,
													defaultPath: path,
												}),
											);
											if (selected.canceled || !selected.filePaths[0]) return;
											if (
												(yield* io(() =>
													realpath(selected.filePaths[0] ?? ""),
												)) !== path
											)
												return yield* new FirmwareTargetMismatch();
											const bookmark = selected.bookmarks?.[0];
											if (bookmark) {
												const release =
													app.startAccessingSecurityScopedResource(bookmark);
												stopAccess = trackBookmark(() => release());
												yield* io(() =>
													atomicJson(
														join(root, "firmware-volume-hint-v1.json"),
														{
															bookmark,
														},
													),
												);
											}
										}
										yield* firmware.write(input.volumeId);
									}).pipe(
										Effect.onExit((result) =>
											Exit.isFailure(result)
												? Effect.sync(() => stopAccess?.())
												: Effect.void,
										),
									);
									break;
								}
								case "firmware-close":
									yield* firmware.close();
									break;
								case "firmware-cancel":
									yield* firmware.cancel();
									break;
								case "export":
									message = (yield* doExport()) ? "Export Success" : "";
									break;
								case "import": {
									if (runningFirmware(yield* firmware.snapshot()))
										return yield* new FirmwareTargetMismatch();
									const selected = yield* io(() =>
										dialog.showOpenDialog({
											title: "Import",
											filters: [
												{ name: "Encrypted ZIP backup", extensions: ["zip"] },
											],
											properties: ["openFile"],
										}),
									);
									const path = selected.filePaths[0];
									if (selected.canceled || !path) break;
									const restored = yield* io(async () => {
										if ((await lstat(path)).size > 128 * 1024 * 1024)
											throw new RestoreFailed();
										return prepareRestore(await readFile(path), path);
									});
									if (
										!(yield* io(() =>
											confirm(
												"Import backup and exit?",
												"Profiles and resources will be merged. Reopen open-quake after import.",
											),
										))
									)
										break;
									replacement = () =>
										restoreAndExit({
											validate: () => restored.validate(root),
											stop: async () => {
												disposed = true;
												await options.stopWriters();
											},
											commit: () => restored.commit(root),
											report: (message) =>
												dialog.showMessageBox({ message, buttons: ["Close"] }),
											exit,
										});
									break;
								}
								case "reset": {
									if (runningFirmware(yield* firmware.snapshot()))
										return yield* new FirmwareTargetMismatch();
									if (
										yield* io(() =>
											confirm(
												input.backup
													? "Back up, then clear all data and exit?"
													: "Clear all data and exit without a backup?",
												"This will clear all data since initialization and cannot be undone.",
											),
										)
									) {
										const reset = yield* DataReset;
										yield* reset.run(input.backup);
									}
									break;
								}
								case "permission": {
									const release = options.permissionFlow?.();
									yield* (
										mock || !checks
											? Effect.void
											: permissionAction(input.key, {
													checks,
													request: nativePermissionRequest,
													open: (key) => Effect.runPromise(openPermission(key)),
												})
									).pipe(Effect.ensuring(Effect.sync(() => release?.())));
									break;
								}
								case "check-update":
									if ((yield* update.snapshot()).state === "disabled") {
										if (!mock)
											yield* io(() => shell.openExternal(RELEASES_PAGE));
										message =
											"GitHub Releases: Linux deb packages need manual installation. Windows builds are unsigned. macOS signing and notarization are pending distributor credentials.";
									}
									yield* update.check();
									break;
								case "download-update":
									yield* update.startDownload();
									break;
								case "install-update":
									if (yield* io(() => confirm("Install update now?")))
										yield* update.install();
									break;
								case "defer-update":
									yield* update.defer();
									break;
							}
							const next = yield* view();
							if (!runningFirmware(next.firmware)) releaseBookmarks();
							return {
								ok: true,
								view: next,
								message,
								...(appearance === undefined ? {} : { appearance }),
							} satisfies MaintenanceReply;
						}).pipe(
							(effect) =>
								options.diagnostics?.instrument(effect, "app.background") ??
								effect,
							Effect.match({
								onFailure: (error) =>
									({ ok: false, code: error.code }) satisfies MaintenanceReply,
								onSuccess: (reply) => reply,
							}),
						),
					);
					// Main owns replacement after the request fiber and its diagnostic span
					// have ended. Closing the shared graph here cannot await this fiber.
					const replace = mutation ? replacement : undefined;
					if (mutation) replacement = undefined;
					if (mutation && replace) {
						const action = Effect.tryPromise({
							try: replace,
							catch: (cause) =>
								cause instanceof ResetFailed || cause instanceof RestoreFailed
									? cause
									: new RestoreFailed(cause),
						});
						// This IO-only effect has no application services. The diagnostic
						// sink stays alive until native exit, including graph finalizers.
						const work = options.diagnostics
							? options.diagnostics
									.instrument(action, "app.background")
									.pipe(Effect.provide(options.diagnostics.layer))
							: action;
						reply = await Effect.runPromise(
							work.pipe(
								Effect.match({
									onFailure: (error): MaintenanceReply => ({
										ok: false,
										code: error.code,
									}),
									onSuccess: () => reply,
								}),
							),
						);
					}
					return reply;
				} finally {
					pendingOperations--;
					if (mutation) {
						mutating = false;
						replacement = undefined;
					}
					// Read-only requests may finish while a reset is unwinding. Only the
					// exclusive mutation that requested exit can dispose its owning runtime.
					if (mutation && requestedExit !== undefined) {
						const code = requestedExit;
						requestedExit = undefined;
						exitStarted = true;
						ipcMain.removeHandler(MAINTENANCE_CHANNEL);
						try {
							await runtime.dispose();
						} finally {
							await nativeExit(code);
						}
					}
				}
			};
			ipcMain.handle(
				MAINTENANCE_CHANNEL,
				(
					event,
					input: unknown,
				): Promise<MaintenanceReply> | MaintenanceReply => {
					if (
						!maintenanceRequestAllowed(
							event.sender.getURL(),
							options.renderer,
							event.senderFrame === event.sender.mainFrame,
							event.sender === options.management()?.webContents,
							input,
						) ||
						!Schema.is(MaintenanceCommand)(input)
					)
						return { ok: false, code: "QUAKE.SETTINGS.REQUEST_DENIED" };
					return request(input);
				},
			);
			let disposal: Promise<void> | undefined;
			return {
				request,
				ready,
				dispose: (): Promise<void> => {
					if (disposal) return disposal;
					disposed = true;
					ipcMain.removeHandler(MAINTENANCE_CHANNEL);
					disposal = (async () => {
						const failures: unknown[] = [];
						try {
							await ready;
						} catch (cause) {
							failures.push(cause);
						}
						try {
							if (!exitStarted)
								await runtime.runPromise(
									Effect.flatMap(FirmwareUpdates, (service) =>
										service.shutdown(),
									),
								);
						} catch (cause) {
							failures.push(cause);
						}
						try {
							await runtime.dispose();
						} catch (cause) {
							failures.push(cause);
						}
						if (failures.length)
							throw new MaintenanceShutdownFailed(new AggregateError(failures));
					})();
					return disposal;
				},
				pending: () => pendingOperations,
			};
		},
		options.diagnostics,
		"app.background",
	);
	return prepared;
}

export function registerMaintenance(
	...args: Parameters<typeof prepareMaintenance>
) {
	return prepareMaintenance(...args).standalone();
}

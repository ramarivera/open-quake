import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Schema, Stream } from "effect";
import { BrowserWindow, dialog, ipcMain } from "electron";
import {
	type MetricCollector,
	MonitorCollector,
} from "../../../../../packages/edge/src/monitor/monitor-service";
import { MonitoringService } from "../../../../../packages/edge/src/monitor/monitoring-service";
import {
	MONITOR_ARTWORK,
	MONITOR_METRICS,
	MONITOR_REQUEST,
	MONITOR_SETTINGS,
	MONITOR_STATE_REQUEST,
	MonitorCommand,
	type MonitorReply,
	type SettingsView,
} from "../../shared/monitor-contracts";
import {
	MonitorErrors,
	MonitorMediaUnusable,
	MonitorVideoTooShort,
} from "../../shared/monitor-errors";
import { canRequestClock } from "../clock/clock-ipc";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { applicationIconLibrary } from "../key-library/application-icons";
import { monitorForegroundLive } from "./foreground";
import {
	foregroundArtwork,
	foregroundKey,
	publishMonitoringState,
} from "./foreground-artwork";
import { MonitorStore, monitorStoreLive } from "./monitor-store";
import { nativeCollector } from "./native-collector";
import { selectMedia } from "./native-media";
import { decodeMonitoringRequest, handleMonitoringRequest } from "./rpc";

export function prepareMonitor(
	root: string,
	management: () => BrowserWindow | undefined,
	panel: () => BrowserWindow | undefined,
	collector: MetricCollector = nativeCollector(),
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	diagnostics?: DesktopDiagnostics,
) {
	const prepared = prepareDesktopModule(
		Layer.merge(
			monitorStoreLive(root),
			MonitoringService.Default.pipe(
				Layer.provide(Layer.succeed(MonitorCollector, collector)),
				Layer.provide(monitorForegroundLive()),
			),
		),
		(runtime) => {
			const artwork = foregroundArtwork(applicationIconLibrary());
			let artworkKey: string | undefined;
			const watchers = new Map<Electron.WebContents, () => void>();
			const trusted = (contents: Electron.WebContents): boolean =>
				!contents.isDestroyed() &&
				(contents === management()?.webContents ||
					contents === panel()?.webContents) &&
				canRequestClock(contents.getURL(), renderer, { _tag: "read" }, false);
			let disposed = false;
			let transition = Promise.resolve();
			const broadcastSettings = (view: SettingsView): void => {
				for (const win of new Set([management(), panel()]))
					if (win && !win.isDestroyed() && trusted(win.webContents))
						win.webContents.send(MONITOR_SETTINGS, view);
			};
			const restart = (): Promise<void> => {
				const next = transition.then(async () => {
					if (disposed) return;
					const view = await runtime.runPromise(MonitorStore.configuration());
					await runtime.runPromise(
						MonitoringService.configure(view.settings, watchers.size > 0),
					);
				});
				// A failed transition must not poison future saves or shutdown.
				transition = next.catch(() => undefined);
				return next;
			};
			const delivery = runtime.runFork(
				MonitoringService.subscribe().pipe(
					Effect.flatMap((stream) =>
						Stream.runForEach(stream, (snapshot) =>
							Effect.sync(() => {
								if (disposed) return;
								const send =
									(win: BrowserWindow | undefined) =>
									(channel: string, value: unknown): void => {
										if (
											!disposed &&
											win &&
											!win.isDestroyed() &&
											trusted(win.webContents)
										)
											win.webContents.send(channel, value);
									};
								publishMonitoringState(
									snapshot,
									send(management()),
									send(panel()),
								);
								const key = foregroundKey(snapshot);
								if (key !== artworkKey) {
									artworkKey = key;
									void artwork(snapshot).then((value) => {
										if (key !== artworkKey) return;
										for (const win of new Set([management(), panel()]))
											send(win)(MONITOR_ARTWORK, value);
									});
								}
								for (const contents of watchers.keys())
									if (trusted(contents))
										contents.send(MONITOR_METRICS, snapshot.metrics);
							}),
						),
					),
				),
			);
			void restart().catch(() => undefined);
			ipcMain.handle(MONITOR_STATE_REQUEST, async (event, input: unknown) => {
				const message = decodeMonitoringRequest(input);
				if (
					!message ||
					disposed ||
					!trusted(event.sender) ||
					event.sender !== management()?.webContents ||
					event.senderFrame !== event.sender.mainFrame ||
					!BrowserWindow.fromWebContents(event.sender)
				)
					return undefined;
				return runtime.runPromise(handleMonitoringRequest(message));
			});
			ipcMain.handle(
				MONITOR_REQUEST,
				async (event, input: unknown): Promise<MonitorReply> => {
					const decoded = Schema.decodeUnknownOption(MonitorCommand)(input);
					const reject = (): MonitorReply => ({
						_tag: "failure",
						code: MonitorErrors.ConfigInvalid.code,
						message: MonitorErrors.ConfigInvalid.message,
					});
					if (
						decoded._tag === "None" ||
						disposed ||
						!trusted(event.sender) ||
						!BrowserWindow.fromWebContents(event.sender) ||
						event.senderFrame !== event.sender.mainFrame ||
						!canRequestClock(
							event.sender.getURL(),
							renderer,
							{ _tag: "read" },
							false,
						)
					)
						return reject();
					const command = decoded.value,
						isManagement = event.sender === management()?.webContents;
					if (
						command._tag !== "read" &&
						command._tag !== "watch" &&
						command._tag !== "artwork" &&
						command._tag !== "resolveMedia" &&
						!isManagement
					)
						return reject();
					if (
						command._tag === "read" &&
						command.styleId !== undefined &&
						!isManagement
					)
						return reject();
					if (command._tag === "artwork") {
						const snapshot = await runtime.runPromise(
							MonitoringService.snapshot(),
						);
						return { _tag: "foregroundArtwork", ...(await artwork(snapshot)) };
					}
					if (command._tag === "watch") {
						// Only main-owned management and live panel identities can request collection.
						if (command.active && !watchers.has(event.sender)) {
							const remove = (): void => {
								watchers.get(event.sender)?.();
								if (!disposed) void restart().catch(() => undefined);
							};
							const detach = (): void => {
								watchers.delete(event.sender);
								event.sender.removeListener("destroyed", remove);
								event.sender.removeListener("render-process-gone", remove);
								event.sender.removeListener("did-start-navigation", remove);
							};
							watchers.set(event.sender, detach);
							event.sender.once("destroyed", remove);
							event.sender.once("render-process-gone", remove);
							event.sender.once("did-start-navigation", remove);
						} else if (!command.active) watchers.get(event.sender)?.();
						await restart();
						return {
							_tag: "success",
							view: await runtime.runPromise(MonitorStore.read()),
						};
					}
					const execute = Effect.gen(function* () {
						const store = yield* MonitorStore;
						switch (command._tag) {
							case "resolveMedia":
								return {
									_tag: "media",
									slot: command.slot,
									view: yield* store.resolveMedia(command.slot),
								} as const;
							case "read":
								return {
									_tag: "success",
									view: yield* store.read(command.styleId),
								} as const;
							case "save":
								return {
									_tag: "success",
									view: yield* store.save(command.revision, command.settings),
								} as const;
							case "chooseMedia": {
								const result = yield* Effect.promise(() =>
									dialog.showOpenDialog({
										title: "Change background",
										properties: ["openFile"],
										filters: [
											{
												name: "Image or video",
												extensions: [
													"png",
													"jpg",
													"jpeg",
													"webp",
													"gif",
													"bmp",
													"mp4",
													"webm",
													"mov",
													"mkv",
												],
											},
										],
									}),
								);
								const path = result.filePaths[0];
								if (result.canceled || !path)
									return { _tag: "cancelled" } as const;
								const selected = yield* Effect.tryPromise({
									try: () => selectMedia(path),
									catch: (cause) =>
										cause instanceof MonitorVideoTooShort ||
										cause instanceof MonitorMediaUnusable
											? cause
											: new MonitorMediaUnusable(cause),
								});
								return {
									_tag: "media",
									...(yield* store.stage(selected)),
								} as const;
							}
						}
					}).pipe(
						Effect.catchTags({
							MonitorConfigInvalid: (error) =>
								Effect.succeed({
									_tag: "failure",
									code: error.code,
									message: error.message,
								} as const),
							MonitorPersistenceFailed: (error) =>
								Effect.succeed({
									_tag: "failure",
									code: error.code,
									message: error.message,
								} as const),
							MonitorMediaUnusable: (error) =>
								Effect.succeed({
									_tag: "failure",
									code: error.code,
									message: error.message,
								} as const),
							MonitorVideoTooShort: (error) =>
								Effect.succeed({
									_tag: "failure",
									code: error.code,
									message: error.message,
								} as const),
						}),
					);
					const reply = await runtime.runPromise(execute);
					if (command._tag === "save" && reply._tag === "success") {
						broadcastSettings(reply.view);
						await restart();
					}
					return reply;
				},
			);
			return {
				dispose: async (): Promise<void> => {
					disposed = true;

					for (const detach of watchers.values()) detach();
					watchers.clear();
					ipcMain.removeHandler(MONITOR_REQUEST);
					ipcMain.removeHandler(MONITOR_STATE_REQUEST);
					await transition;
					await runtime.runPromise(Fiber.interrupt(delivery));
					await runtime.dispose();
				},
			};
		},
		diagnostics,
		"app.background",
	);
	return prepared;
}

export function registerMonitor(...args: Parameters<typeof prepareMonitor>) {
	return prepareMonitor(...args).standalone();
}

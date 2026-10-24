import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { BrowserWindow, dialog, ipcMain } from "electron";
import {
	type MetricCollector,
	MonitorCollector,
	MonitorService,
} from "../../../../../packages/edge/src/monitor/monitor-service";
import {
	MONITOR_METRICS,
	MONITOR_REQUEST,
	MONITOR_SETTINGS,
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
import { MonitorStore, monitorStoreLive } from "./monitor-store";
import { nativeCollector } from "./native-collector";
import { selectMedia } from "./native-media";

export function registerMonitor(
	root: string,
	management: () => BrowserWindow | undefined,
	panel: () => BrowserWindow | undefined,
	collector: MetricCollector = nativeCollector(),
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
) {
	const runtime = ManagedRuntime.make(
		Layer.merge(
			monitorStoreLive(root),
			MonitorService.Default.pipe(
				Layer.provide(Layer.succeed(MonitorCollector, collector)),
			),
		),
	);
	const watchers = new Map<Electron.WebContents, () => void>();
	const trusted = (contents: Electron.WebContents): boolean =>
		!contents.isDestroyed() &&
		(contents === management()?.webContents ||
			contents === panel()?.webContents) &&
		canRequestClock(contents.getURL(), renderer, { _tag: "read" }, false);
	let running: Fiber.RuntimeFiber<void> | undefined;
	let transition = Promise.resolve(),
		generation = 0,
		disposed = false;
	const stop = async (): Promise<void> => {
		const fiber = running;
		running = undefined;
		if (fiber) await runtime.runPromise(Fiber.interrupt(fiber));
	};
	const broadcastSettings = (view: SettingsView): void => {
		for (const win of new Set([management(), panel()]))
			if (win && !win.isDestroyed() && trusted(win.webContents))
				win.webContents.send(MONITOR_SETTINGS, view);
	};
	const restart = (): Promise<void> => {
		const requested = ++generation;
		transition = transition.then(async () => {
			await stop();
			if (disposed || requested !== generation) return;
			const view = await runtime.runPromise(MonitorStore.configuration());
			if (
				disposed ||
				requested !== generation ||
				!view.settings.enabled ||
				!watchers.size
			)
				return;
			running = runtime.runFork(
				MonitorService.watch(view.settings.hz).pipe(
					Effect.flatMap((stream) =>
						Stream.runForEach(stream, (snapshot) =>
							Effect.sync(() => {
								for (const contents of watchers.keys())
									if (contents === panel()?.webContents && trusted(contents))
										contents.send(MONITOR_METRICS, snapshot);
							}),
						),
					),
				),
			);
		});
		return transition;
	};
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
			if (command._tag !== "read" && command._tag !== "watch" && !isManagement)
				return reject();
			if (
				command._tag === "read" &&
				command.styleId !== undefined &&
				!isManagement
			)
				return reject();
			if (command._tag === "watch") {
				// Main-owned window identity controls live collection. PC previews cannot subscribe.
				if (event.sender !== panel()?.webContents || isManagement)
					return reject();
				if (command.active && !watchers.has(event.sender)) {
					const remove = (): void => {
						watchers.get(event.sender)?.();
						if (!disposed) void restart();
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
						if (result.canceled || !path) return { _tag: "cancelled" } as const;
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
			generation++;
			for (const detach of watchers.values()) detach();
			watchers.clear();
			ipcMain.removeHandler(MONITOR_REQUEST);
			await transition;
			await stop();
			await runtime.dispose();
		},
	};
}

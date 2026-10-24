import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { app, type BrowserWindow, ipcMain } from "electron";
import type { KnobModelContext } from "../../../../../packages/device/src/knob/model/contracts.js";
import {
	type KnobModelPort,
	KnobModelPorts,
} from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import type { QuakeEvent } from "../../preload/quake";
import {
	KNOB_REQUEST,
	KNOB_SNAPSHOT,
	type KnobReply,
	KnobRequest,
} from "../../shared/knob-contracts";
import {
	type DesktopKnobBindings,
	desktopKnobAdapters,
} from "./desktop-adapters";
import { canRequestKnob } from "./permissions";

export function makeKnobRuntime(ports: KnobModelPort) {
	return ManagedRuntime.make(
		KnobModel.DefaultWithoutDependencies.pipe(
			Layer.provide(Layer.succeed(KnobModelPorts, ports)),
		),
	);
}
export type KnobRuntime = ReturnType<typeof makeKnobRuntime>;
export function registerKnobRuntime(
	runtime: KnobRuntime,
	load: Effect.Effect<
		KnobModelContext,
		import("../../../../../packages/device/src/knob/knob-errors.js").KnobError
	>,
	panel: () => BrowserWindow | undefined,
	windows: () => readonly BrowserWindow[],
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
) {
	let initialized: Promise<void> | undefined;
	let stream: Fiber.RuntimeFiber<void> | undefined;
	let disposed = false;
	let pending = Promise.resolve();
	const initialize = (): Promise<void> => {
		initialized ??= runtime
			.runPromise(load.pipe(Effect.flatMap(KnobModel.configure)))
			.then(() => {
				if (!disposed)
					stream = runtime.runFork(
						Effect.gen(function* () {
							const model = yield* KnobModel;
							yield* Stream.runForEach(model.snapshots, (snapshot) =>
								Effect.sync(() => {
									for (const win of windows())
										if (!win.isDestroyed() && !win.webContents.isDestroyed())
											win.webContents.send(KNOB_SNAPSHOT, snapshot);
								}),
							);
						}),
					);
			});
		return initialized;
	};
	ipcMain.handle(
		KNOB_REQUEST,
		async (event, input: unknown): Promise<KnobReply> => {
			if (
				disposed ||
				event.senderFrame !== event.sender.mainFrame ||
				!windows().some((w) => w.webContents === event.sender) ||
				!canRequestKnob(
					event.sender.getURL(),
					renderer,
					input,
					event.sender === panel()?.webContents,
				)
			)
				return { _tag: "failure", code: "QUAKE.KNOB.CONFIG_INVALID" };
			const command = Schema.decodeUnknownSync(KnobRequest)(input);
			try {
				await initialize();
				return await runtime.runPromise(
					Effect.gen(function* () {
						if (command._tag !== "Read") yield* KnobModel.dispatch(command);
						return {
							_tag: "success" as const,
							snapshot: yield* KnobModel.snapshot(),
						};
					}).pipe(
						Effect.match({
							onFailure: (error): KnobReply => ({
								_tag: "failure",
								code: error.code,
							}),
							onSuccess: (value): KnobReply => value,
						}),
					),
				);
			} catch {
				return { _tag: "failure", code: "QUAKE.KNOB.DISPATCH_FAILED" };
			}
		},
	);
	return {
		onDevice(event: QuakeEvent): void {
			if (
				disposed ||
				event.kind === "keepalive" ||
				event.kind === "touch" ||
				(event.kind === "status" && event.state !== "connected" && !initialized)
			)
				return;
			pending = pending
				.then(async () => {
					if (disposed) return;
					await initialize();
					await runtime.runPromise(
						Effect.gen(function* () {
							const { context } = yield* KnobModel.snapshot();
							const sessionId = context.session.sessionId;
							if (event.kind === "rotate")
								yield* KnobModel.dispatch({
									_tag: "Rotate",
									sessionId,
									delta: event.direction,
								});
							else if (
								event.kind === "press" &&
								[1, 2, 5, 255].includes(event.state ?? 1)
							)
								yield* KnobModel.dispatch({
									_tag: "Key",
									sessionId,
									code: event.state ?? 1,
								});
							else if (event.kind === "status" && event.state !== "connected")
								yield* KnobModel.dispatch({ _tag: "Disconnect", sessionId });
							else if (event.kind === "status" && event.state === "connected")
								yield* load.pipe(Effect.flatMap(KnobModel.configure));
						}).pipe(
							Effect.match({
								onFailure: () => undefined,
								onSuccess: () => undefined,
							}),
						),
					);
				})
				.catch(() => {
					initialized = undefined;
				});
		},
		async dispose(): Promise<void> {
			disposed = true;
			ipcMain.removeHandler(KNOB_REQUEST);
			await pending;
			if (stream) await runtime.runPromise(Fiber.interrupt(stream));
			await runtime.dispose();
		},
	};
}

export function registerKnob(
	panel: () => BrowserWindow | undefined,
	windows: () => readonly BrowserWindow[],
	bindings: DesktopKnobBindings = {},
) {
	const adapters = desktopKnobAdapters(app.getPath("userData"), bindings);
	return registerKnobRuntime(
		makeKnobRuntime(adapters.ports),
		adapters.load,
		panel,
		windows,
	);
}

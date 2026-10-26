import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Schema, Stream } from "effect";
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
import type { DesktopDiagnostics } from "../diagnostics";
import {
	type DesktopRuntime,
	prepareDesktopModule,
} from "../diagnostics/module";
import { makeDesktopRuntime } from "../diagnostics/runtime";
import {
	type DesktopKnobBindings,
	desktopKnobAdapters,
} from "./desktop-adapters";
import { canRequestKnob } from "./permissions";
import { observeVolume } from "./volume-observer";

export function makeKnobRuntime(
	ports: KnobModelPort,
	diagnostics?: DesktopDiagnostics,
) {
	return makeDesktopRuntime(
		KnobModel.DefaultWithoutDependencies.pipe(
			Layer.provide(Layer.succeed(KnobModelPorts, ports)),
		),
		diagnostics,
	);
}
export type KnobRuntime = DesktopRuntime<KnobModel>;
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
	observation?: {
		readonly readVolume: KnobModelPort["readVolume"];
		readonly contextVersion?: () => string;
	},
) {
	let initialized: Promise<void> | undefined;
	let stream: Fiber.RuntimeFiber<void> | undefined;
	let disposed = false;
	let connected = true;
	let observer: Fiber.RuntimeFiber<never> | undefined;
	let pending = Promise.resolve();
	const lifetime = new AbortController();
	const run = <A, E>(effect: Effect.Effect<A, E, KnobModel>): Promise<A> =>
		runtime.runPromise(effect, { signal: lifetime.signal });
	const initialize = (): Promise<void> => {
		initialized ??= run(load.pipe(Effect.flatMap(KnobModel.configure)))
			.then(() => {
				if (!disposed) {
					if (observation)
						observer = runtime.runFork(
							observeVolume(
								observation.readVolume,
								() => !disposed && connected,
							),
						);
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
				}
			})
			.catch((cause) => {
				initialized = undefined;
				throw cause;
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
				if (disposed)
					return { _tag: "failure", code: "QUAKE.KNOB.DISPATCH_FAILED" };
				return await run(
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
		onDevice(event: QuakeEvent): Promise<void> {
			if (event.kind === "status") connected = event.state === "connected";
			if (
				disposed ||
				event.kind === "keepalive" ||
				event.kind === "touch" ||
				(event.kind === "status" && event.state !== "connected" && !initialized)
			)
				return Promise.resolve();
			let completion: Effect.Effect<
				void,
				import("../../../../../packages/device/src/knob/knob-errors.js").KnobError
			> = Effect.void;
			pending = pending
				.then(async () => {
					if (disposed) return;
					await initialize();
					if (disposed) return;
					await run(
						Effect.gen(function* () {
							const { context } = yield* KnobModel.snapshot();
							const sessionId = context.session.sessionId;
							if (event.kind === "rotate")
								completion = yield* KnobModel.preparePhysicalRotation(
									sessionId,
									event.direction,
								);
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
							Effect.matchEffect({
								onFailure: (error) => Effect.logWarning(error),
								onSuccess: () => Effect.void,
							}),
						),
					);
				})
				.catch(() => {
					// runPromise diagnostics retain the failed exit; a dispatch failure must not restart owned observers.
				});
			// Observe native completion separately so the root bus can enqueue the next event.
			void pending.then(() => run(completion)).catch(() => {});
			return pending;
		},
		async refresh(): Promise<void> {
			if (disposed) return;
			await initialize();
			if (disposed) return;
			// Reconciliation owns catalog invalidation and active-content replacement.
			await run(load.pipe(Effect.flatMap(KnobModel.synchronize)));
		},
		async dispose(): Promise<void> {
			disposed = true;
			ipcMain.removeHandler(KNOB_REQUEST);
			// Interrupt registration-owned loads/dispatches before draining the queue.
			lifetime.abort();
			await pending;
			await runtime.runPromise(KnobModel.cancelPhysicalRotations());
			if (observer) await runtime.runPromise(Fiber.interrupt(observer));
			if (stream) await runtime.runPromise(Fiber.interrupt(stream));
			await runtime.dispose();
		},
	};
}

export function prepareKnob(
	panel: () => BrowserWindow | undefined,
	windows: () => readonly BrowserWindow[],
	bindings: DesktopKnobBindings = {},
	diagnostics?: DesktopDiagnostics,
) {
	const adapters = desktopKnobAdapters(app.getPath("userData"), bindings);
	return prepareDesktopModule(
		KnobModel.DefaultWithoutDependencies.pipe(
			Layer.provide(Layer.succeed(KnobModelPorts, adapters.ports)),
		),
		(runtime) =>
			registerKnobRuntime(runtime, adapters.load, panel, windows, undefined, {
				readVolume: adapters.ports.readVolume,
				contextVersion: adapters.contextVersion,
			}),
		diagnostics,
	);
}

export function registerKnob(...args: Parameters<typeof prepareKnob>) {
	return prepareKnob(...args).standalone();
}

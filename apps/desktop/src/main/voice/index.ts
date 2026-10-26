import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Option, Schema } from "effect";
import {
	BrowserWindow,
	clipboard,
	dialog,
	type IpcMainInvokeEvent,
	ipcMain,
	shell,
} from "electron";
import {
	GridVoice,
	GridVoiceRuntime,
	MockVoiceRuntimeLive,
	VoiceRuntimeUnavailable,
	VoiceSurface,
	VoiceSurfacePublisher,
	VoiceTonePort,
} from "../../../../../packages/edge/src/voice/surface/index.js";
import type { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors.js";
import type { KnobCaptureSnapshot } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports.js";
import type { QuakeEvent } from "../../preload/quake";
import {
	safeHttpUrl,
	VOICE_REQUEST_CHANNEL,
	VOICE_SURFACE_CHANNEL,
	type VoiceSurfaceEvent,
	VoiceSurfaceEvent as VoiceSurfaceEventSchema,
	type VoiceSurfaceReply,
	VoiceSurfaceReply as VoiceSurfaceReplySchema,
	VoiceSurfaceRequest,
	type VoiceTone,
} from "../../shared/voice-surface";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { isAppRenderer } from "../profiles/profile-ipc";

/**
 * strip-voice-ui in main: the voice surface conductor, its Electron ports,
 * and the `voice:request` edge. See openspec/changes/strip-voice-ui.
 */

const encodeEvent = Schema.encodeSync(VoiceSurfaceEventSchema);
const encodeReply = Schema.encodeSync(VoiceSurfaceReplySchema);
const decodeRequest = Schema.decodeUnknownEither(VoiceSurfaceRequest, {
	onExcessProperty: "error",
});

/** Where tones go. hardware-controls (PR #22) replaces the recorder with `playTone`. */
export interface VoiceToneSink {
	readonly play: (serial: string, tone: VoiceTone) => void;
}
/** Records tones without writing HID; the default until the hardware layer lands. */
export function createToneRecorder(limit = 64): VoiceToneSink & {
	readonly played: () => ReadonlyArray<{ serial: string; tone: VoiceTone }>;
} {
	const played: Array<{ serial: string; tone: VoiceTone }> = [];
	return {
		play: (serial, tone) => {
			played.push({ serial, tone });
			if (played.length > limit) played.shift();
		},
		played: () => played,
	};
}

/** Plays through every sink, e.g. the recorder and hardware-controls. */
export const toneSinks = (
	...sinks: readonly VoiceToneSink[]
): VoiceToneSink => ({
	play: (serial, tone) => {
		for (const sink of sinks) sink.play(serial, tone);
	},
});

/** No knob or grid voice runtime yet: voice starts fail visibly, never silently. */
export const UnavailableRuntimeLive = Layer.succeed(GridVoiceRuntime, {
	select: () => Effect.void,
	startCapture: () => Effect.fail(new VoiceRuntimeUnavailable()),
	releaseCapture: () => Effect.void,
	cancelCapture: () => Effect.void,
	cancelFlow: () => Effect.void,
	sendText: () => Effect.fail(new VoiceRuntimeUnavailable()),
});

export interface VoiceSurfaceOptions {
	readonly diagnostics?: DesktopDiagnostics;
	readonly knobRoute?: (
		serial: string,
	) => Effect.Effect<KnobCaptureSnapshot, VoiceKnobRejected>;
	/** `OPEN_QUAKE_MOCK_DEVICE=1`: bind the scripted runtime. */
	readonly mock: boolean;
	/** Explicit speech controller. Chat configuration alone never enables speech. */
	readonly speech?: {
		readonly stopReadAloud?: (owner: {
			readonly serial: string;
			readonly keyCode: string;
		}) => Promise<boolean>;
		readonly readAloud: (
			text: string,
			owner: { readonly serial: string; readonly keyCode: string },
		) => Promise<VoiceSurfaceReply>;
		readonly onEvent: (event: VoiceSurfaceEvent) => void;
	};
	readonly tones: VoiceToneSink;
	/** The device the strip shows; events carry it for per-device dedupe. */
	readonly serial: () => string;
	readonly panel: () => BrowserWindow | undefined;
	readonly management: () => BrowserWindow | undefined;
	readonly renderer?: string;
	/** Decorates the existing runtime without replacing normal AI/capture behavior. */
	readonly runtime?: (
		fallback: Layer.Layer<GridVoiceRuntime, never, VoiceSurface>,
	) => Layer.Layer<GridVoiceRuntime, never, VoiceSurface>;
}

export const voiceSurfaceLayer = (
	options: Pick<VoiceSurfaceOptions, "mock" | "tones" | "runtime">,
	publish: (event: VoiceSurfaceEvent) => void,
) => {
	const fallback = options.mock ? MockVoiceRuntimeLive : UnavailableRuntimeLive;
	return GridVoice.Default.pipe(
		Layer.provideMerge(
			(options.runtime ? options.runtime(fallback) : fallback).pipe(
				Layer.provideMerge(
					VoiceSurface.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(VoiceSurfacePublisher, {
									publish: (event: VoiceSurfaceEvent) =>
										Effect.sync(() => publish(event)),
								}),
								Layer.succeed(VoiceTonePort, {
									play: (serial, tone) =>
										Effect.sync(() => options.tones.play(serial, tone)),
								}),
							),
						),
					),
				),
			),
		),
	);
};

function broadcast(event: VoiceSurfaceEvent): void {
	const value = encodeEvent(event);
	for (const window of BrowserWindow.getAllWindows())
		if (!window.isDestroyed() && !window.webContents.isDestroyed())
			window.webContents.send(VOICE_SURFACE_CHANNEL, value);
}

const rejected = (code: string): VoiceSurfaceReply => ({
	_tag: "rejected",
	code,
});
const ok: VoiceSurfaceReply = { _tag: "ok" };

/** knob model's `KnobVoiceInput`, minus its session (knob-model-parity). */
export interface KnobVoiceRequest {
	readonly action: "holdStart" | "release" | "interrupt" | "cancel";
	readonly generation: number;
	readonly session?: {
		readonly deviceId: string;
		readonly profileId: string;
		readonly revision: number;
	};
}

export function prepareVoiceSurface(options: VoiceSurfaceOptions) {
	const renderer =
		options.renderer ??
		process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
	const answers = new Map<
		string,
		{ turnId: string; text: string; seq: number; overflow: boolean }
	>();
	const answerKey = (serial: string, keyCode: string) =>
		`${serial}\u0000${keyCode}`;
	const publish = (event: VoiceSurfaceEvent) => {
		if (event._tag === "Reset") {
			for (const key of answers.keys())
				if (key.startsWith(`${event.serial}\u0000`)) answers.delete(key);
		} else if (event._tag === "TurnStarted") {
			answers.set(answerKey(event.serial, event.keyCode), {
				turnId: event.turnId,
				text: "",
				seq: -1,
				overflow: false,
			});
			while (answers.size > 16) {
				const key = answers.keys().next().value;
				if (key !== undefined) answers.delete(key);
			}
		} else if (event._tag === "Chunk" && event.chunk.type === "answer") {
			const answer = answers.get(answerKey(event.serial, event.keyCode));
			if (
				answer?.turnId === event.chunk.turnId &&
				event.chunk.seq > answer.seq
			) {
				answer.seq = event.chunk.seq;
				const combined = answer.text + event.chunk.textDelta;
				answer.overflow ||= combined.length > 4000;
				answer.text = combined.slice(0, 4000);
			}
		}
		broadcast(event);
		options.speech?.onEvent(event);
	};

	const prepared = prepareDesktopModule(
		voiceSurfaceLayer(options, publish),
		(runtime) => {
			const run = <A>(
				effect: Effect.Effect<A, never, GridVoice | VoiceSurface>,
			): Promise<A> => runtime.runPromise(effect);
			let disconnected = false;
			let linkGeneration = 0;
			const knobHolds = new Map<
				string,
				{ generation: number; cancelled: boolean }
			>();

			const handle = async (
				event: IpcMainInvokeEvent,
				raw: unknown,
			): Promise<VoiceSurfaceReply> => {
				if (
					!BrowserWindow.fromWebContents(event.sender) ||
					event.senderFrame !== event.sender.mainFrame ||
					!isAppRenderer(event.sender.getURL(), renderer)
				)
					return rejected("VOICE.SURFACE.REQUEST_INVALID");
				const decoded = decodeRequest(raw);
				if (decoded._tag === "Left")
					return rejected("VOICE.SURFACE.REQUEST_INVALID");
				const request = decoded.right;
				const serial = options.serial();
				switch (request._tag) {
					case "Hello": {
						const status = await run(VoiceSurface.agentStatus());
						if (!event.sender.isDestroyed())
							event.sender.send(VOICE_SURFACE_CHANNEL, encodeEvent(status));
						return ok;
					}
					case "Input": {
						const generation = linkGeneration;
						return run(
							Effect.suspend(() =>
								disconnected || generation !== linkGeneration
									? Effect.succeed(
											rejected("VOICE.SURFACE.DEVICE_DISCONNECTED"),
										)
									: GridVoice.input(serial, request.input).pipe(Effect.as(ok)),
							),
						);
					}
					case "ResetContext":
						return runtime.runPromise(
							Effect.flatMap(GridVoiceRuntime, (owner) =>
								owner.resetContext
									? owner.resetContext(serial, request.keyCode).pipe(
											Effect.as(ok),
											Effect.catchTag("VoiceRuntimeUnavailable", (error) =>
												Effect.succeed(rejected(error.code)),
											),
										)
									: Effect.succeed(rejected("VOICE.RUNTIME.UNAVAILABLE")),
							),
						);
					case "Reset":
						await run(GridVoice.reset(serial, request.reason));
						return ok;
					case "SendText":
						return run(
							GridVoice.sendText({
								serial,
								keyCode: request.keyCode,
								agentId: request.agentId,
								message: request.message,
							}).pipe(
								(effect) =>
									options.diagnostics?.instrument(effect, "voice.request") ??
									effect,
								Effect.as(ok),
								Effect.catchTag("VoiceRuntimeUnavailable", (error) =>
									Effect.succeed(rejected(error.code)),
								),
							),
						);
					case "OpenLink":
						return Option.match(safeHttpUrl(request.url), {
							onNone: () => rejected("VOICE.SURFACE.LINK_REJECTED"),
							onSome: async (url) => {
								await shell.openExternal(url);
								return ok;
							},
						});
					case "CopyText":
						clipboard.writeText(request.text.trim());
						return ok;
					case "PickFiles": {
						// DK focuses the main window for the dialog (QBI:557-595).
						const parent = options.management();
						parent?.focus();
						const dialogOptions: Electron.OpenDialogOptions = {
							title: "Choose file(s) to attach",
							properties: ["openFile", "multiSelections"],
							filters: [{ name: "All Files", extensions: ["*"] }],
						};
						const result = parent
							? await dialog.showOpenDialog(parent, dialogOptions)
							: await dialog.showOpenDialog(dialogOptions);
						return {
							_tag: "files",
							paths: result.canceled ? [] : result.filePaths,
						};
					}
					case "FocusPanel": {
						const management = options.management();
						if (management && !management.isDestroyed()) management.focus();
						// Main focuses the strip window 80 ms later (QBI:598-653).
						const panel = options.panel();
						if (!panel || panel.isDestroyed())
							return rejected("VOICE.SURFACE.PANEL_UNAVAILABLE");
						await new Promise<void>((done) => setTimeout(done, 80));
						if (!panel.isDestroyed()) panel.focus();
						return ok;
					}
					case "ReadAloud": {
						const owner = { serial, keyCode: request.keyCode };
						if (await options.speech?.stopReadAloud?.(owner)) return ok;
						const answer = answers.get(answerKey(serial, request.keyCode));
						if (answer?.overflow) return rejected("VOICE.TTS.QUEUE_FULL");
						const text = answer?.text;
						if (!options.speech || !text?.trim())
							return rejected("VOICE.TTS.UNAVAILABLE");
						return options.speech.readAloud(text, owner);
					}
				}
			};
			ipcMain.handle(
				VOICE_REQUEST_CHANNEL,
				async (event, raw): Promise<unknown> =>
					encodeReply(await handle(event, raw)),
			);
			let shutdown: Promise<void> | undefined;
			return {
				ready: run(Effect.void),
				publish: (event: VoiceSurfaceEvent) => run(VoiceSurface.publish(event)),
				reset: () => run(GridVoice.reset(options.serial(), "profileChanged")),
				onDevice: (event: QuakeEvent) => {
					if (event.kind !== "status") return Promise.resolve();
					disconnected = event.state !== "connected";
					if (!disconnected) return Promise.resolve();
					linkGeneration++;
					const hold = knobHolds.get(options.serial());
					if (hold) hold.cancelled = true;
					return run(GridVoice.reset(options.serial(), "disconnected"));
				},
				knobVoice: ({ action, generation, session }: KnobVoiceRequest) =>
					Effect.suspend(() => {
						const serial = session?.deviceId ?? options.serial();
						if (disconnected && action === "holdStart") return Effect.void;
						const link = linkGeneration;
						const prior = knobHolds.get(serial);
						if (action === "holdStart" && prior?.generation === generation)
							return Effect.void;
						const hold =
							action === "holdStart" ? { generation, cancelled: false } : prior;
						if (action === "holdStart" && hold) knobHolds.set(serial, hold);
						else if (
							hold &&
							(action === "interrupt" || hold.generation === generation)
						)
							hold.cancelled = true;
						const dispatch = Effect.gen(function* () {
							const snapshot =
								action === "holdStart" && options.knobRoute
									? yield* options.knobRoute(serial).pipe(Effect.either)
									: undefined;
							if (
								action === "holdStart" &&
								(disconnected ||
									link !== linkGeneration ||
									hold?.cancelled ||
									knobHolds.get(serial) !== hold)
							)
								return;
							if (
								snapshot?._tag === "Left" ||
								(snapshot?._tag === "Right" &&
									session &&
									(session.profileId !== snapshot.right.profileId ||
										session.revision !== snapshot.right.revision))
							) {
								return yield* VoiceSurface.publish({
									_tag: "Stage",
									serial,
									keyCode: "0,1",
									captureId: `0,1/knob-${generation}`,
									stage: {
										_tag: "failed",
										reason: "unavailable",
										errorCode:
											snapshot._tag === "Left"
												? snapshot.left.code
												: "VOICE.KNOB.ROUTE_INCOMPLETE",
									},
								});
							}
							yield* GridVoice.knob(
								serial,
								action,
								generation,
								snapshot?._tag === "Right" ? snapshot.right : undefined,
							);
						});
						// Don't hold the physical device queue while committed storage is loading.
						// The module runtime owns this setup fiber and cancels it on disposal.
						return action === "holdStart"
							? Effect.sync(() => {
									runtime.runFork(dispatch);
								})
							: Effect.promise(() => run(dispatch));
					}),

				dispose: () => {
					if (shutdown) return shutdown;
					ipcMain.removeHandler(VOICE_REQUEST_CHANNEL);
					shutdown = runtime.dispose();
					return shutdown;
				},
			};
		},
		options.diagnostics,
		"voice.request",
	);
	return prepared;
}

export function registerVoiceSurface(options: VoiceSurfaceOptions): {
	readonly ready: Promise<void>;
	readonly publish: (event: VoiceSurfaceEvent) => Promise<void>;
	/** The knob model's `voice` binding: knob holds drive the overlay. */
	readonly knobVoice: (input: KnobVoiceRequest) => Effect.Effect<void>;
	/** Called before forwarding device status to renderers. */
	readonly onDevice: (event: QuakeEvent) => Promise<void>;
	/** Main-process connection changes clear the same owner as profile changes. */
	readonly reset: () => Promise<void>;
	readonly dispose: () => Promise<void>;
} {
	return prepareVoiceSurface(options).standalone();
}

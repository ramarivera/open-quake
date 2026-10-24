import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
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
	/** `OPEN_QUAKE_MOCK_DEVICE=1`: bind the scripted runtime. */
	readonly mock: boolean;
	readonly tones: VoiceToneSink;
	/** The device the strip shows; events carry it for per-device dedupe. */
	readonly serial: () => string;
	readonly panel: () => BrowserWindow | undefined;
	readonly management: () => BrowserWindow | undefined;
	readonly renderer?: string;
}

export const voiceSurfaceLayer = (
	options: Pick<VoiceSurfaceOptions, "mock" | "tones">,
	publish: (event: VoiceSurfaceEvent) => void,
) =>
	GridVoice.Default.pipe(
		Layer.provideMerge(
			(options.mock ? MockVoiceRuntimeLive : UnavailableRuntimeLive).pipe(
				Layer.provideMerge(
					VoiceSurface.Default.pipe(
						Layer.provide(
							Layer.mergeAll(
								Layer.succeed(VoiceSurfacePublisher, {
									publish: (event) => Effect.sync(() => publish(event)),
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
}

export function registerVoiceSurface(options: VoiceSurfaceOptions): {
	readonly publish: (event: VoiceSurfaceEvent) => Promise<void>;
	/** The knob model's `voice` binding: knob holds drive the overlay. */
	readonly knobVoice: (input: KnobVoiceRequest) => Effect.Effect<void>;
	/** Called before forwarding device status to renderers. */
	readonly onDevice: (event: QuakeEvent) => Promise<void>;
	readonly dispose: () => Promise<void>;
} {
	const renderer =
		options.renderer ??
		process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
	const runtime = ManagedRuntime.make(voiceSurfaceLayer(options, broadcast));
	const run = <A>(
		effect: Effect.Effect<A, never, GridVoice | VoiceSurface>,
	): Promise<A> => runtime.runPromise(effect);
	let disconnected = false;
	let linkGeneration = 0;

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
							? Effect.succeed(rejected("VOICE.SURFACE.DEVICE_DISCONNECTED"))
							: GridVoice.input(serial, request.input).pipe(Effect.as(ok)),
					),
				);
			}
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
				// Main focuses the strip window 80 ms later (QBI:598-653).
				const panel = options.panel();
				if (!panel || panel.isDestroyed())
					return rejected("VOICE.SURFACE.PANEL_UNAVAILABLE");
				await new Promise<void>((done) => setTimeout(done, 80));
				if (!panel.isDestroyed()) panel.focus();
				return ok;
			}
			case "ReadAloud":
				// Text-to-speech belongs to voice-stt-tts; nothing plays it yet.
				return rejected("VOICE.TTS.UNAVAILABLE");
		}
	};
	ipcMain.handle(
		VOICE_REQUEST_CHANNEL,
		async (event, raw): Promise<unknown> =>
			encodeReply(await handle(event, raw)),
	);
	let shutdown: Promise<void> | undefined;
	return {
		publish: (event) => run(VoiceSurface.publish(event)),
		onDevice: (event) => {
			if (event.kind !== "status") return Promise.resolve();
			disconnected = event.state !== "connected";
			if (!disconnected) return Promise.resolve();
			linkGeneration++;
			return run(GridVoice.reset(options.serial(), "disconnected"));
		},
		knobVoice: ({ action, generation }) =>
			Effect.promise(() =>
				run(
					Effect.suspend(() =>
						disconnected && action === "holdStart"
							? Effect.void
							: GridVoice.knob(options.serial(), action, generation),
					),
				),
			),
		dispose: () => {
			if (shutdown) return shutdown;
			ipcMain.removeHandler(VOICE_REQUEST_CHANNEL);
			shutdown = runtime.dispose();
			return shutdown;
		},
	};
}

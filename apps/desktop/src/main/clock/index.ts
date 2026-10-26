import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, Option, Schema } from "effect";
import {
	BrowserWindow,
	dialog,
	ipcMain,
	net,
	protocol,
	session,
} from "electron";
import type { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import {
	CLOCK_MEDIA_SCHEME,
	CLOCK_REQUEST,
	CLOCK_SNAPSHOT,
	ClockCommand,
	type ClockReply,
	ClockSnapshot,
	type ClockTarget,
} from "../../shared/clock-contracts";
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "../../shared/clock-style";
import type { DesktopRuntime } from "../diagnostics/module";
import { clockProfileLayer } from "../profiles/clock-profile-binding";
import {
	canRequestClock,
	canRequestClockMedia,
	handleClockCommand,
	parseMediaUrl,
} from "./clock-ipc";
import { ClockStore, ClockLive as clockLayer } from "./clock-store";
import { isClockVideoProbe, probeClockVideo } from "./native-video-probe";

export const ClockLive = (
	root: string,
	profiles?: DesktopRuntime<ProfileRepository>,
) =>
	profiles
		? clockLayer(root, { duration: probeClockVideo }).pipe(
				Layer.provide(clockProfileLayer(profiles)),
			)
		: clockLayer(root, { duration: probeClockVideo });

/**
 * Must run before `app.whenReady()`: media elements need a standard, secure,
 * streamable scheme to seek inside videos.
 */
export function registerClockScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: CLOCK_MEDIA_SCHEME,
			privileges: {
				standard: true,
				secure: true,
				corsEnabled: true,
				stream: true,
				supportFetchAPI: true,
			},
		},
	]);
}

function broadcast(snapshot: unknown): void {
	for (const window of BrowserWindow.getAllWindows())
		if (!window.isDestroyed() && !window.webContents.isDestroyed())
			window.webContents.send(CLOCK_SNAPSHOT, snapshot);
}

const chooseFile = (
	window: BrowserWindow | undefined,
): Effect.Effect<Option.Option<string>> =>
	Effect.promise(() => {
		const options: Electron.OpenDialogOptions = {
			title: "Change background",
			properties: ["openFile"],
			filters: [
				{
					name: "Image or video",
					extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS],
				},
			],
		};
		return window
			? dialog.showOpenDialog(window, options)
			: dialog.showOpenDialog(options);
	}).pipe(
		Effect.map((result) =>
			result.canceled
				? Option.none()
				: Option.fromNullable(result.filePaths[0]),
		),
		Effect.catchAllDefect(() => Effect.succeed(Option.none())),
	);

/** IPC for the clock bridge and the custom-media protocol. Main owns the runtime. */
export function registerClock(
	runtime: DesktopRuntime<ClockStore, never>,
	managementWindow: () => BrowserWindow | undefined,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	authority?: {
		readonly panel: () => BrowserWindow | undefined;
		readonly target: (keyCode: string) => Promise<ClockTarget | undefined>;
	},
): { dispose: () => Promise<void> } {
	ipcMain.handle(
		CLOCK_REQUEST,
		async (event, input: unknown): Promise<ClockReply> => {
			const isManagement = event.sender === managementWindow()?.webContents;
			if (
				!BrowserWindow.fromWebContents(event.sender) ||
				event.senderFrame !== event.sender.mainFrame ||
				!canRequestClock(event.sender.getURL(), renderer, input, isManagement)
			)
				return {
					_tag: "failure",
					code: "QUAKE.CLOCK.CONFIG_INVALID",
					message: "Clock request was rejected",
				};
			let command = input;
			if (authority && !isManagement) {
				if (
					event.sender !== authority.panel()?.webContents ||
					!Schema.is(ClockCommand)(input)
				)
					return {
						_tag: "failure",
						code: "QUAKE.CLOCK.CONFIG_INVALID",
						message: "Clock request was rejected",
						reason: "no-target",
					};
				const target = await authority.target(
					input._tag === "setTheme"
						? input.keyCode
						: (input.target?.keyCode ?? "1,1"),
				);
				if (
					!target ||
					(input.target &&
						JSON.stringify(input.target) !== JSON.stringify(target))
				)
					return {
						_tag: "failure",
						code: "QUAKE.CLOCK.CONFIG_INVALID",
						message: "Clock target is unavailable",
						reason: "no-target",
					};
				command = { ...input, target };
			}
			const reply = await runtime.runPromise(
				handleClockCommand(
					command,
					chooseFile(BrowserWindow.fromWebContents(event.sender) ?? undefined),
				),
			);
			const tag =
				typeof input === "object" && input !== null && "_tag" in input
					? input._tag
					: "";
			if (reply._tag === "success" && tag !== "read") {
				const snapshot = {
					...reply.snapshot,
					change: tag,
					source: isManagement ? "pc-grid" : "device-screen",
				};
				if (Schema.is(ClockSnapshot)(snapshot)) broadcast(snapshot);
			}
			return reply;
		},
	);
	// Serves a theme's saved file (or a staged candidate) by id. Unknown ids
	// and unset slots are 404; the renderer never names a path.
	// The protocol Request omits Electron's frame identity. Authorize using
	// webRequest's browser-owned initiator before the protocol reads a file.
	session.defaultSession.webRequest.onBeforeRequest(
		{ urls: [`${CLOCK_MEDIA_SCHEME}://*/*`] },
		(details, callback) => {
			const contents = details.webContents;
			const allowed =
				contents &&
				!contents.isDestroyed() &&
				BrowserWindow.fromWebContents(contents) &&
				details.frame === contents.mainFrame &&
				(canRequestClockMedia(
					details.frame.url,
					renderer,
					details.resourceType,
				) ||
					(isClockVideoProbe(contents) && details.resourceType === "media"));
			callback({ cancel: !allowed });
		},
	);
	protocol.handle(CLOCK_MEDIA_SCHEME, async (request) => {
		const target = parseMediaUrl(request.url);
		if (!target) return new Response(null, { status: 404 });
		const path = await runtime.runPromise(
			ClockStore.mediaPath(target).pipe(
				Effect.catchAll(() => Effect.succeed(Option.none<string>())),
			),
		);
		if (Option.isNone(path)) return new Response(null, { status: 404 });
		const response = await net.fetch(pathToFileURL(path.value).href, {
			headers: request.headers,
		});
		// The authenticated app document captures decoded media into a canvas.
		// Keep the existing browser-owned initiator gate above, including probes.
		const headers = new Headers(response.headers);
		headers.set("Access-Control-Allow-Origin", "*");
		return new Response(response.body, { status: response.status, headers });
	});
	return {
		dispose: async () => {
			ipcMain.removeHandler(CLOCK_REQUEST);
			session.defaultSession.webRequest.onBeforeRequest(null);
			protocol.unhandle(CLOCK_MEDIA_SCHEME);
			await runtime.dispose();
		},
	};
}

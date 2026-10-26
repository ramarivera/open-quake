import { randomBytes } from "node:crypto";
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
	type ClockMediaTarget,
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
	type Grant = {
		owner: Electron.WebContents;
		target: ClockTarget | undefined;
		media: ClockMediaTarget;
	};
	const grants = new Map<string, Grant>();
	const cleanup = new Map<Electron.WebContents, () => void>();
	const revoke = (owner: Electron.WebContents) => {
		for (const url of scopes.get(owner)?.urls.values() ?? [])
			grants.delete(url);
		scopes.delete(owner);
	};
	const scopes = new Map<
		Electron.WebContents,
		{ target: ClockTarget | undefined; urls: Map<string, string> }
	>();
	const sameTarget = (a: ClockTarget | undefined, b: ClockTarget | undefined) =>
		a?.profileId === b?.profileId &&
		a?.pageId === b?.pageId &&
		a?.keyCode === b?.keyCode;
	const scope = (
		owner: Electron.WebContents,
		target: ClockTarget | undefined,
	) => {
		if (!cleanup.has(owner)) {
			const navigated = (
				_event: Electron.Event,
				_url: string,
				_inPlace: boolean,
				main: boolean,
			) => {
				if (main) revoke(owner);
			};
			const destroyed = () => {
				revoke(owner);
				cleanup.get(owner)?.();
				cleanup.delete(owner);
			};
			owner.on("did-start-navigation", navigated);
			owner.once("destroyed", destroyed);
			cleanup.set(owner, () => {
				owner.removeListener("did-start-navigation", navigated);
				owner.removeListener("destroyed", destroyed);
			});
		}
		let current = scopes.get(owner);
		if (!current || !sameTarget(current.target, target)) {
			for (const url of current?.urls.values() ?? []) grants.delete(url);
			current = { target, urls: new Map() };
			scopes.set(owner, current);
		}
		return current;
	};
	const reference = (
		owner: Electron.WebContents,
		target: ClockTarget | undefined,
		source: string,
	) => {
		const current = scope(owner, target);
		const existing = current.urls.get(source);
		if (existing) {
			current.urls.delete(source);
			current.urls.set(source, existing);
			return existing;
		}
		const media = parseMediaUrl(source);
		if (!media) return "";
		// Each owner retains only its current theme revisions and staged candidate.
		if (current.urls.size >= 16) {
			const oldest = current.urls.entries().next().value;
			if (oldest) {
				grants.delete(oldest[1]);
				current.urls.delete(oldest[0]);
			}
		}
		const url = `${CLOCK_MEDIA_SCHEME}://ref/${randomBytes(32).toString("hex")}`;
		current.urls.set(source, url);
		grants.set(url, { owner, target, media });
		return url;
	};
	const project = (
		owner: Electron.WebContents,
		snapshot: ClockSnapshot,
	): ClockSnapshot => {
		scope(owner, snapshot.target);
		return {
			...snapshot,
			media: Object.fromEntries(
				Object.entries(snapshot.media).map(([id, media]) => [
					id,
					{ ...media, url: reference(owner, snapshot.target, media.url) },
				]),
			),
		};
	};
	const allowedGrant = async (grant: Grant): Promise<boolean> => {
		if (
			grant.owner.isDestroyed() ||
			!BrowserWindow.fromWebContents(grant.owner) ||
			!canRequestClockMedia(grant.owner.getURL(), renderer, "image") ||
			!sameTarget(scopes.get(grant.owner)?.target, grant.target)
		)
			return false;
		if (grant.owner === managementWindow()?.webContents) return true;
		if (!authority) return true;
		return (
			grant.owner === authority.panel()?.webContents &&
			sameTarget(
				await authority.target(grant.target?.keyCode ?? "1,1"),
				grant.target,
			)
		);
	};
	const broadcast = async (snapshot: ClockSnapshot): Promise<void> => {
		for (const window of BrowserWindow.getAllWindows()) {
			const owner = window.webContents;
			if (
				window.isDestroyed() ||
				owner.isDestroyed() ||
				!scopes.has(owner) ||
				!sameTarget(scopes.get(owner)?.target, snapshot.target)
			)
				continue;
			if (
				await allowedGrant({
					owner,
					target: snapshot.target,
					media: {
						theme: snapshot.themeId,
						...(snapshot.target ? { target: snapshot.target } : {}),
					},
				})
			)
				owner.send(CLOCK_SNAPSHOT, project(owner, snapshot));
		}
	};
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
				if (Schema.is(ClockSnapshot)(snapshot)) await broadcast(snapshot);
			}
			if (reply._tag === "success")
				return { ...reply, snapshot: project(event.sender, reply.snapshot) };
			if (reply._tag === "candidate") {
				const target = Schema.is(ClockCommand)(command)
					? command.target
					: undefined;
				return { ...reply, url: reference(event.sender, target, reply.url) };
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
		async (details, callback) => {
			const contents = details.webContents;
			const grant = grants.get(details.url);
			const allowed =
				contents &&
				!contents.isDestroyed() &&
				BrowserWindow.fromWebContents(contents) &&
				details.frame === contents.mainFrame &&
				((canRequestClockMedia(
					details.frame.url,
					renderer,
					details.resourceType,
				) &&
					grant?.owner === contents &&
					(await allowedGrant(grant))) ||
					(isClockVideoProbe(contents, details.url) &&
						details.resourceType === "media"));
			callback({ cancel: !allowed });
		},
	);
	protocol.handle(CLOCK_MEDIA_SCHEME, async (request) => {
		const grant = grants.get(request.url);
		const parsed = parseMediaUrl(request.url);
		const target =
			grant && (await allowedGrant(grant))
				? grant.media
				: parsed && "candidate" in parsed
					? parsed
					: null;
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
		// Canvas thumbnails need CORS. Grant only the exact app origin after the
		// browser-owned frame and opaque owner/target checks above.
		const headers = new Headers(response.headers);
		const origin = new URL(renderer).origin;
		if (grant && request.headers.get("Origin") === origin)
			headers.set("Access-Control-Allow-Origin", origin);
		return new Response(response.body, { status: response.status, headers });
	});
	return {
		dispose: async () => {
			for (const remove of cleanup.values()) remove();
			cleanup.clear();
			grants.clear();
			scopes.clear();
			ipcMain.removeHandler(CLOCK_REQUEST);
			session.defaultSession.webRequest.onBeforeRequest(null);
			protocol.unhandle(CLOCK_MEDIA_SCHEME);
			await runtime.dispose();
		},
	};
}

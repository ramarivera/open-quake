import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Fiber, Layer, Stream } from "effect";
import { app, BrowserWindow, ipcMain } from "electron";
import {
	type ProfileEnvelope,
	type ProfileRepositoryError,
	ProfileService,
	type ProfileStoragePort,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/index.js";
import {
	encodeProfileSnapshotReply,
	PROFILES_READ,
	PROFILES_SNAPSHOT,
	type ProfileSnapshotReply,
} from "../../shared/profile-snapshot-contracts";
import type { DesktopRuntime } from "../diagnostics/module";
import { createDesktopProfileStorage } from "./local-profile-storage";

export const ProfilesLive = (
	storage: ProfileStoragePort,
): Layer.Layer<ProfileService> =>
	ProfileService.Default.pipe(Layer.provide(profileStorageLayer(storage)));

/** `<userData>/profiles-v1.json`, the app's own store (never DK-Suite's). */
export const desktopProfilesLive = (userData: string) =>
	ProfilesLive(createDesktopProfileStorage(join(userData, "profiles-v1.json")));

/** Catalog identity only; the diagnostic cause never crosses IPC. */
export const profileFailure = (
	error: ProfileRepositoryError,
): ProfileSnapshotReply => ({
	_tag: "failure",
	code: error.code,
	message: error.message,
});
const ready = (envelope: ProfileEnvelope): ProfileSnapshotReply => ({
	_tag: "ready",
	envelope,
});

/** Same origin and path as the app's renderer, top-level frame only. */
export function isAppRenderer(caller: string, renderer: string): boolean {
	try {
		const url = new URL(caller);
		const expected = new URL(renderer);
		return (
			url.protocol === expected.protocol &&
			url.host === expected.host &&
			url.pathname === expected.pathname
		);
	} catch {
		return false;
	}
}

function broadcast(reply: ProfileSnapshotReply): void {
	const value = encodeProfileSnapshotReply(reply);
	for (const window of BrowserWindow.getAllWindows())
		if (!window.isDestroyed() && !window.webContents.isDestroyed())
			window.webContents.send(PROFILES_SNAPSHOT, value);
}

/**
 * Read-only profile delivery to the panel and management windows
 * (strip-key-grid "Panel and preview render one strip"). `profiles:read`
 * loads and answers; every committed snapshot is then pushed. Editing
 * commands belong to profiles-key-grid task 2.1 and the profile manager.
 */
export function registerProfiles<R>(
	runtime: DesktopRuntime<R | ProfileService, never>,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	owned = true,
): { dispose: () => Promise<void> } {
	const load = ProfileService.loadProfiles().pipe(
		Effect.map(({ envelope }) => ready(envelope)),
		Effect.catchAll((error) => Effect.succeed(profileFailure(error))),
	);
	// Nothing touches disk until a window asks. The first read seeds the
	// committed ref; from then on every committed snapshot is pushed.
	const published = runtime.runFork(
		ProfileService.subscribeCommittedProfiles().pipe(
			Effect.flatMap((snapshots) =>
				Stream.runForEach(snapshots, (envelope) =>
					Effect.sync(() => broadcast(ready(envelope))),
				),
			),
		),
	);
	ipcMain.handle(PROFILES_READ, async (event): Promise<unknown> => {
		if (
			!BrowserWindow.fromWebContents(event.sender) ||
			event.senderFrame !== event.sender.mainFrame ||
			!isAppRenderer(event.sender.getURL(), renderer)
		)
			return encodeProfileSnapshotReply({
				_tag: "failure",
				code: "QUAKE.PROFILE.READ_FAILED",
				message: "Profile request was rejected",
			});
		return encodeProfileSnapshotReply(await runtime.runPromise(load));
	});
	let shutdown: Promise<void> | undefined;
	const dispose = (): Promise<void> => {
		if (shutdown) return shutdown;
		ipcMain.removeHandler(PROFILES_READ);
		app.removeListener("before-quit", onBeforeQuit);
		shutdown = runtime.runPromise(Fiber.interrupt(published)).then(async () => {
			if (owned) await runtime.dispose();
		});
		return shutdown;
	};
	let quitting = false;
	const onBeforeQuit = (event: Electron.Event): void => {
		event.preventDefault();
		if (!quitting) {
			quitting = true;
			void dispose().then(() => app.quit());
		}
	};
	if (owned) app.on("before-quit", onBeforeQuit);
	return { dispose };
}

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { HardwareSession } from "@open-quake/device";
import { Effect, ManagedRuntime, Schema } from "effect";
import { dialog, ipcMain, powerMonitor } from "electron";
import { LightingService } from "../../../../../packages/device/src/lighting/lighting-service";
import {
	HARDWARE_REQUEST,
	HardwareRequest,
} from "../../shared/hardware-contracts";
import type { DesktopDiagnostics } from "../diagnostics";
import { canRequestWallpaper } from "../media/media-permissions";
import { hardwareRequest } from "./controller";
import { qmkRequest } from "./qmk-controller";
import { sharedLighting } from "./qmk-lighting";

export function registerHardware(
	current: () => HardwareSession | undefined,
	managementWindow: () => { readonly webContents: object } | undefined,
	mock: boolean,
	renderer = process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href,
	diagnostics?: DesktopDiagnostics,
	sessions: () => readonly HardwareSession[] = () => {
		const session = current();
		return session ? [session] : [];
	},
	panelSerial?: (sender: Electron.WebContents) => string | undefined,
): () => Promise<void> {
	const observe = <A, E>(work: Effect.Effect<A, E>) =>
		diagnostics
			? diagnostics
					.instrument(work, "voice.device")
					.pipe(Effect.provide(diagnostics.layer))
			: work;
	const lighting = ManagedRuntime.make(sharedLighting(sessions));
	ipcMain.handle(HARDWARE_REQUEST, (event, input: unknown) => {
		const command = HardwareRequest.pipe(Schema.decodeUnknownEither)(input);
		const owner = panelSerial?.(event.sender);
		const management = event.sender === managementWindow()?.webContents;
		if (
			command._tag === "Left" ||
			(!management && !owner) ||
			event.senderFrame !== event.sender.mainFrame ||
			!canRequestWallpaper(event.sender.getURL(), renderer, input, true) ||
			(!management && command.right._tag !== "read")
		)
			return { _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" };
		return Effect.runPromise(
			observe(
				Effect.gen(function* () {
					let target = management ? current() : undefined;
					const requested =
						command.right._tag === "read" ? command.right.serial : undefined;
					if (command.right._tag === "chooseGameTarget") {
						const kind = command.right.kind;
						return yield* Effect.promise(async () => {
							const result = await dialog.showOpenDialog({
								properties: [kind === "folder" ? "openDirectory" : "openFile"],
								...(kind === "application" && process.platform === "darwin"
									? { filters: [{ name: "Applications", extensions: ["app"] }] }
									: {}),
							});
							return result.canceled || !result.filePaths[0]
								? { _tag: "cancelled" as const }
								: { _tag: "gameTarget" as const, path: result.filePaths[0] };
						});
					}
					const serial = management ? requested : owner;
					if (serial) {
						target = undefined;
						for (const candidate of sessions())
							if ((yield* candidate.snapshot()).serial === serial)
								target = candidate;
					}
					if (
						command.right._tag === "qmk" ||
						command.right._tag === "qmkTargets" ||
						command.right._tag === "qmkBindings"
					)
						return yield* qmkRequest(input, sessions());
					if (command.right._tag === "lighting") {
						const request = command.right;
						return yield* Effect.tryPromise({
							try: () =>
								lighting.runPromise(
									Effect.gen(function* () {
										const service = yield* LightingService;
										const state =
											request.action._tag === "select"
												? yield* service.select(request)
												: request.action._tag === "save"
													? yield* service.save(request)
													: yield* service
															.setDesired(request, request.action.change)
															.pipe(Effect.zipRight(service.flush(request)));
										return {
											_tag: "lighting" as const,
											session: request.session,
											status: state.status,
											fields: state.capabilities.fields,
											values: state.applied,
											saveStatus: state.saveStatus,
										};
									}).pipe(
										Effect.catchAll((error) =>
											Effect.succeed({
												_tag: "failure" as const,
												code: error.code,
											}),
										),
									),
								),
							catch: () => ({
								_tag: "failure" as const,
								code: "QUAKE.HARDWARE.UNAVAILABLE",
							}),
						}).pipe(Effect.catchAll(Effect.succeed));
					}
					return yield* hardwareRequest(input, target, mock);
				}),
			),
		);
	});
	const setLocked = (locked: boolean): void => {
		for (const session of sessions())
			void Effect.runPromise(
				observe(session.setLocked(locked)).pipe(
					Effect.matchEffect({
						onSuccess: () => Effect.void,
						onFailure: (error) => observe(Effect.logWarning(error)),
					}),
				),
			);
	};
	const lock = () => setLocked(true);
	const unlock = () => setLocked(false);
	powerMonitor.on("lock-screen", lock);
	powerMonitor.on("unlock-screen", unlock);
	return () => {
		ipcMain.removeHandler(HARDWARE_REQUEST);

		powerMonitor.removeListener("lock-screen", lock);
		powerMonitor.removeListener("unlock-screen", unlock);
		return lighting.dispose();
	};
}

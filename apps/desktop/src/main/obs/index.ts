import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Effect, Fiber, Layer, Redacted, Schema } from "effect";
import { app, type BrowserWindow, ipcMain, type WebContents } from "electron";
import {
	type ObsCommand,
	obsCommandFromKey,
} from "../../../../../packages/device/src/actions/obs-contracts";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	emptyObsSaved,
	type ObsTile,
	type ObsVisible,
} from "../../../../../packages/edge/src/obs/obs-contracts";
import {
	ObsConfigurationRejected,
	ObsNetworkFailed,
} from "../../../../../packages/edge/src/obs/obs-errors";
import { ObsStorage } from "../../../../../packages/edge/src/obs/obs-repository";
import {
	ObsPorts,
	ObsService,
} from "../../../../../packages/edge/src/obs/obs-service";
import { openObsConnection } from "../../../../../packages/edge/src/obs/obs-transport";
import {
	OBS_LIVE,
	OBS_REQUEST,
	type ObsReply,
	ObsRequest,
} from "../../shared/obs";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { integrationRequestAllowed } from "../integrations/permissions";
import { fileStore, systemCredentialVault } from "../integrations/storage";
import { detectLocalObs } from "./detection";
export function prepareObs(options: {
	readonly renderer: string;
	readonly management: () => BrowserWindow | undefined;
	readonly panel: () => BrowserWindow | undefined;
	readonly visibleKeys: () => Promise<readonly ObsVisible[]>;
	readonly diagnostics?: DesktopDiagnostics;
	readonly mock?: boolean;
	readonly storage?: ObsStorage["Type"];
	readonly open?: ObsPorts["Type"]["open"];
}) {
	const owners = new Map<
		string,
		{ readonly sender: WebContents; readonly lease: string }
	>();
	const watchers = new Map<WebContents, () => void>();
	const root = app.getPath("userData");
	const layer = ObsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(
					ObsStorage,
					options.storage ?? {
						store: fileStore(root, "obs-v1.json", emptyObsSaved),
						vault: systemCredentialVault(join(root, "credentials")),
						detect: options.mock
							? async () => undefined
							: () => detectLocalObs(),
					},
				),
				Layer.succeed(ObsPorts, {
					authorizeVisible: async (owner, tiles) => {
						const target = owners.get(owner);
						if (!target || target.sender.isDestroyed()) return false;
						if (target.sender === options.management()?.webContents)
							return true;
						if (target.sender !== options.panel()?.webContents) return false;
						const committed = await options.visibleKeys();
						return (
							owners.get(owner) === target &&
							tiles.every((tile) =>
								committed.some(
									(key) =>
										key.id === tile.id &&
										isDeepStrictEqual(key.command, tile.command),
								),
							)
						);
					},
					open:
						options.open ??
						(options.mock
							? async () => {
									throw new ObsNetworkFailed();
								}
							: openObsConnection),
					publish: (owner: string, tiles: readonly ObsTile[]) => {
						const target = owners.get(owner);
						if (target && !target.sender.isDestroyed())
							target.sender.send(OBS_LIVE, { lease: target.lease, tiles });
					},
				}),
			),
		),
	);
	return prepareDesktopModule(
		layer,
		(runtime) => {
			let disposed = false;
			const initialize = runtime.runFork(ObsService.initialize());
			const release = (sender: WebContents) => {
				for (const [owner, entry] of owners)
					if (entry.sender === sender) {
						owners.delete(owner);
						runtime.runFork(ObsService.release(owner));
					}
			};
			ipcMain.handle(
				OBS_REQUEST,
				async (event, input: unknown): Promise<ObsReply> => {
					const decoded = Schema.decodeUnknownEither(ObsRequest)(input, {
						onExcessProperty: "error",
					});
					const management = event.sender === options.management()?.webContents;
					if (
						disposed ||
						decoded._tag === "Left" ||
						(!management && event.sender !== options.panel()?.webContents) ||
						!integrationRequestAllowed(
							event.senderFrame?.url ?? "",
							options.renderer,
							event.senderFrame === event.sender.mainFrame,
							management,
							decoded._tag === "Right" &&
								(decoded.right.type === "visible" ||
									decoded.right.type === "status")
								? "ha.live"
								: "obs.write",
						)
					)
						return {
							type: "error",
							code: "OBS.IPC.REJECTED",
							message: "OBS request was rejected",
						};
					const request = decoded.right;
					if (request.type === "visible") {
						const owner = `${event.sender.id}:${request.lease}`;
						if (
							!owners.has(owner) &&
							[...owners.values()].filter(
								(entry) => entry.sender === event.sender,
							).length >= 16
						)
							return {
								type: "error",
								code: "OBS.IPC.REJECTED",
								message: "Too many visible OBS tiles",
							};
						if (!watchers.has(event.sender)) {
							const clear = () => release(event.sender);
							watchers.set(event.sender, clear);
							event.sender.on("destroyed", clear);
							event.sender.on("did-start-navigation", clear);
						}
						const entry = { sender: event.sender, lease: request.lease };
						if (request.tiles.length) owners.set(owner, entry);
						else owners.delete(owner);
						return runtime.runPromise(
							ObsService.setVisible(owner, request.tiles).pipe(
								Effect.onError(() =>
									owners.get(owner) === entry
										? ObsService.release(owner).pipe(
												Effect.zipRight(
													Effect.sync(() => owners.delete(owner)),
												),
											)
										: Effect.void,
								),
								Effect.match({
									onSuccess: (): ObsReply => ({ type: "ok" }),
									onFailure: (error): ObsReply => ({
										type: "error",
										code: error.code,
										message: error.message,
									}),
								}),
							),
						);
					}
					if (request.type === "catalog")
						return runtime.runPromise(
							ObsService.catalog(request.sceneUuid).pipe(
								Effect.match({
									onSuccess: (catalog): ObsReply => ({
										type: "catalog",
										catalog,
									}),
									onFailure: (error): ObsReply => ({
										type: "error",
										code: error.code,
										message: error.message,
									}),
								}),
							),
						);
					const action =
						request.type === "configure"
							? ObsService.configure(
									request.config,
									request.password === undefined
										? undefined
										: Redacted.make(request.password),
								)
							: request.type === "connect"
								? ObsService.connect()
								: request.type === "disconnect"
									? ObsService.disconnect()
									: request.type === "detect"
										? ObsService.detect()
										: ObsService.status();
					return runtime.runPromise(
						action.pipe(
							Effect.match({
								onSuccess: (status): ObsReply => ({ type: "status", status }),
								onFailure: (error): ObsReply => ({
									type: "error",
									code: error.code,
									message: error.message,
								}),
							}),
						),
					);
				},
			);
			return {
				execute: (command: ObsCommand, signal: AbortSignal) =>
					runtime.runPromise(ObsService.execute(command), { signal }),
				turn: (
					key: ProfileKey,
					delta: -1 | 1 | undefined,
					signal: AbortSignal,
					beforeWrite: () => Promise<void>,
				) => {
					const command = obsCommandFromKey(key);
					return command._tag === "Left"
						? Promise.reject(new ObsConfigurationRejected(command.left))
						: runtime.runPromise(
								ObsService.execute(command.right, delta, beforeWrite),
								{
									signal,
								},
							);
				},
				dispose: async () => {
					disposed = true;
					ipcMain.removeHandler(OBS_REQUEST);
					await runtime.runPromise(
						Effect.forEach([...owners.keys()], (owner) =>
							ObsService.release(owner),
						),
					);
					for (const [sender, clear] of watchers) {
						sender.removeListener("destroyed", clear);
						sender.removeListener("did-start-navigation", clear);
						clear();
					}
					watchers.clear();
					owners.clear();
					await runtime.runPromise(Fiber.interrupt(initialize));
					await runtime.runPromise(ObsService.disconnect());
					await runtime.dispose();
				},
			};
		},
		options.diagnostics,
		"app.background",
	);
}

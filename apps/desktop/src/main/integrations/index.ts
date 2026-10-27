import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Cause, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import type {
	ChannelRuntime,
	CredentialVault,
} from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	ChannelPorts,
	ChannelService,
} from "../../../../../packages/edge/src/channels/channel-service";
import {
	DraftUnavailable,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/channels/integration-errors";
import { unavailableChannelRuntime } from "../../../../../packages/edge/src/channels/runtime-adapter";
import {
	EMPTY_HA_STORE,
	type HaKey,
} from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	type HaPortShape,
	HaPorts,
	HomeAssistantService,
} from "../../../../../packages/edge/src/home-assistant/ha-service";
import {
	ShortcutPorts,
	ShortcutService,
} from "../../../../../packages/edge/src/shortcuts/shortcut-service";
import {
	INTEGRATIONS_LIVE,
	INTEGRATIONS_REQUEST,
	type IntegrationReply,
	IntegrationRequest,
} from "../../shared/integrations";
import { KEY_LIBRARY_CHANGED } from "../../shared/key-library";
import type { DesktopDiagnostics } from "../diagnostics";
import type { DesktopRuntime } from "../diagnostics/module";
import { prepareDesktopModule } from "../diagnostics/module";
import { makeIntegrationController } from "./controller";
import { openHaRest } from "./ha-rest";
import { integrationRequestAllowed } from "./permissions";
import { integrationProfiles, visibleHaEntities } from "./profiles";
import { fileStore, systemCredentialVault } from "./storage";
export const HA_POLL_INTERVAL_MS = 2000;

export function prepareIntegrations<R>(options: {
	readonly diagnostics?: DesktopDiagnostics;
	readonly management: () => BrowserWindow | undefined;
	readonly panel?: () => BrowserWindow | undefined;
	readonly rendererURL: string;
	readonly profileRuntime: DesktopRuntime<
		R | ProfileService | ProfileRepository,
		never
	>;
	readonly channelRuntime?: ChannelRuntime;
	readonly vault?: CredentialVault;
	readonly openHa?: HaPortShape["open"];
	readonly draftShortcuts?: (
		request: string,
		signal?: AbortSignal,
	) => Promise<string>;
}) {
	const root = join(app.getPath("userData"), "integrations-v1");
	const vault =
		options.vault ?? systemCredentialVault(join(root, "credentials"));
	const profiles = integrationProfiles(options.profileRuntime);

	const prepared = prepareDesktopModule(
		Layer.mergeAll(
			ChannelService.Default.pipe(
				Layer.provide(
					Layer.succeed(ChannelPorts, {
						store: fileStore(root, "channels.json", {
							version: 1,
							channels: [],
						}),
						vault,
						runtime: options.channelRuntime ?? unavailableChannelRuntime(),
						now: Date.now,
						id: randomUUID,
					}),
				),
			),
			ShortcutService.Default.pipe(
				Layer.provide(
					Layer.succeed(ShortcutPorts, {
						store: fileStore(root, "shortcuts.json", {
							version: 1,
							libraries: [],
						}),
						id: randomUUID,
						now: () => new Date().toISOString(),
						sync: profiles.sync,
						...(options.draftShortcuts
							? { draft: options.draftShortcuts }
							: {}),
					}),
				),
			),
			HomeAssistantService.Default.pipe(
				Layer.provide(
					Layer.succeed(HaPorts, {
						store: fileStore(root, "home-assistant.json", EMPTY_HA_STORE),
						vault,
						open: options.openHa ?? openHaRest,
						place: profiles.place,
					}),
				),
			),
		),
		(runtime) => {
			const controller = runtime.runPromise(
				makeIntegrationController({
					openExternal: (url) => shell.openExternal(url),
					targets: profiles.targets,
				}),
			);
			let disposed = false;
			let disposal: Promise<void> | undefined;
			const pending = new Set<Promise<unknown>>();
			const draftingLifetime = new AbortController();
			const updateVisible = (
				envelope: Parameters<typeof visibleHaEntities>[0],
			) =>
				Effect.promise(() =>
					runtime.runPromise(
						HomeAssistantService.setVisible(visibleHaEntities(envelope)),
					),
				);
			const profileMonitor = options.profileRuntime.runFork(
				Effect.gen(function* () {
					const service = yield* ProfileService;
					const initial = yield* service.loadProfiles();
					yield* updateVisible(initial.envelope);
					yield* Stream.runForEach(
						yield* service.subscribeCommittedProfiles(),
						updateVisible,
					);
				}),
			);
			const publish = (value: unknown) => {
				if (disposed) return;
				for (const win of BrowserWindow.getAllWindows()) {
					if (
						(win !== options.management() && win !== options.panel?.()) ||
						win.isDestroyed() ||
						win.webContents.isDestroyed() ||
						!integrationRequestAllowed(
							win.webContents.getURL(),
							options.rendererURL,
							true,
							true,
							"ha.live",
						)
					)
						continue;
					win.webContents.send(INTEGRATIONS_LIVE, value);
				}
			};
			let polling = false;
			const timer = setInterval(() => {
				if (disposed || polling) return;
				polling = true;
				const operation = runtime
					.runPromise(
						HomeAssistantService.poll().pipe(
							Effect.match({
								onSuccess: publish,
								onFailure: () => publish({ connected: false, states: [] }),
							}),
						),
					)
					.finally(() => {
						polling = false;
						pending.delete(operation);
					});
				pending.add(operation);
			}, HA_POLL_INTERVAL_MS);
			ipcMain.handle(
				INTEGRATIONS_REQUEST,
				async (event, input: unknown): Promise<IntegrationReply> => {
					const request = Schema.decodeUnknownEither(IntegrationRequest)(
						input,
						{
							onExcessProperty: "error",
						},
					);
					if (
						disposed ||
						request._tag === "Left" ||
						!BrowserWindow.fromWebContents(event.sender) ||
						(event.sender !== options.management()?.webContents &&
							event.sender !== options.panel?.()?.webContents) ||
						!integrationRequestAllowed(
							event.senderFrame?.url ?? "",
							options.rendererURL,
							event.senderFrame === event.sender.mainFrame,
							event.sender === options.management()?.webContents,
							request._tag === "Right" ? request.right.type : "",
						)
					)
						return {
							type: "error",
							code: "INTEGRATION.IPC.REJECTED",
							message: "Integration request was rejected",
							field: "",
						};
					const operation = controller.then(async (c) => {
						if (request.right.type !== "shortcuts.generate")
							return runtime.runPromise(c.request(request.right));
						const result = await runtime.runPromiseExit(
							c.request(request.right),
							{
								signal: draftingLifetime.signal,
							},
						);
						if (Exit.isSuccess(result)) return result.value;
						if (
							draftingLifetime.signal.aborted &&
							Cause.isInterruptedOnly(result.cause)
						) {
							const error = new DraftUnavailable();
							return {
								type: "error" as const,
								code: error.code,
								message: error.message,
								field: "",
							};
						}
						throw Cause.squash(result.cause);
					});
					pending.add(operation);
					try {
						const reply = await operation;
						if (
							reply.type === "libraries" &&
							["shortcuts.save", "shortcuts.remove"].includes(
								request.right.type,
							)
						)
							options.management()?.webContents.send(KEY_LIBRARY_CHANGED);
						return reply;
					} finally {
						pending.delete(operation);
					}
				},
			);
			const track = <A>(run: () => Promise<A>): Promise<A> => {
				if (disposed) return Promise.reject(new RuntimeUnavailable());
				const operation = run();
				pending.add(operation);
				return operation.finally(() => pending.delete(operation));
			};
			return {
				aiEntities: () =>
					track(() => runtime.runPromise(HomeAssistantService.aiEntities())),
				executeHa: (key: HaKey) =>
					track(() =>
						runtime.runPromise(HomeAssistantService.execute(key, true)),
					),
				/** Trusted, explicitly configured direct-key actions. Never expose as an AI tool. */
				executeHaFromKey: (
					key: HaKey,
					signal: AbortSignal,
					isCurrent: () => boolean = () => true,
				) =>
					track(() =>
						runtime.runPromise(
							HomeAssistantService.execute(key, false, isCurrent),
							{
								signal,
							},
						),
					),
				dispose: () => {
					if (disposal) return disposal;
					disposal = (async () => {
						disposed = true;
						draftingLifetime.abort();
						clearInterval(timer);
						ipcMain.removeHandler(INTEGRATIONS_REQUEST);
						await options.profileRuntime.runPromise(
							Fiber.interrupt(profileMonitor),
						);
						await Promise.allSettled([...pending]);
						await runtime.dispose();
					})();
					return disposal;
				},
			};
		},
		options.diagnostics,
		"app.background",
	);
	return prepared;
}

export function registerIntegrations<R>(
	options: Parameters<typeof prepareIntegrations<R>>[0],
) {
	return prepareIntegrations(options).standalone();
}

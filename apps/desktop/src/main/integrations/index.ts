import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import type { ChannelRuntime } from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	ChannelPorts,
	ChannelService,
} from "../../../../../packages/edge/src/channels/channel-service";
import { unavailableChannelRuntime } from "../../../../../packages/edge/src/channels/runtime-adapter";
import {
	EMPTY_HA_STORE,
	type HaKey,
} from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
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
import { makeIntegrationController } from "./controller";
import { openHaRest } from "./ha-rest";
import { integrationRequestAllowed } from "./permissions";
import { integrationProfiles, visibleHaEntities } from "./profiles";
import { fileStore, systemCredentialVault } from "./storage";
export const HA_POLL_INTERVAL_MS = 2000;

export function registerIntegrations<R>(options: {
	readonly management: () => BrowserWindow | undefined;
	readonly rendererURL: string;
	readonly profileRuntime: ManagedRuntime.ManagedRuntime<
		R | ProfileService | ProfileRepository,
		never
	>;
	readonly channelRuntime?: ChannelRuntime;
	readonly draftShortcuts?: (request: string) => Promise<string>;
}) {
	const root = join(app.getPath("userData"), "integrations-v1");
	const vault = systemCredentialVault(join(root, "credentials"));
	const profiles = integrationProfiles(options.profileRuntime);
	const runtime = ManagedRuntime.make(
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
						open: openHaRest,
						place: profiles.place,
					}),
				),
			),
		),
	);
	const controller = runtime.runPromise(
		makeIntegrationController({
			openExternal: (url) => shell.openExternal(url),
			targets: profiles.targets,
		}),
	);
	let disposed = false;
	const pending = new Set<Promise<unknown>>();
	const updateVisible = (envelope: Parameters<typeof visibleHaEntities>[0]) =>
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
			const request = Schema.decodeUnknownEither(IntegrationRequest)(input, {
				onExcessProperty: "error",
			});
			if (
				disposed ||
				request._tag === "Left" ||
				!BrowserWindow.fromWebContents(event.sender) ||
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
			const operation = controller.then((c) =>
				runtime.runPromise(c.request(request.right)),
			);
			pending.add(operation);
			try {
				return await operation;
			} finally {
				pending.delete(operation);
			}
		},
	);
	return {
		aiEntities: () => runtime.runPromise(HomeAssistantService.aiEntities()),
		executeHa: (key: HaKey, fromAi = false) =>
			runtime.runPromise(HomeAssistantService.execute(key, fromAi)),
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			clearInterval(timer);
			ipcMain.removeHandler(INTEGRATIONS_REQUEST);
			await options.profileRuntime.runPromise(Fiber.interrupt(profileMonitor));
			await Promise.allSettled([...pending]);
			await runtime.runPromise(
				Effect.all([ChannelService.dispose(), HomeAssistantService.dispose()]),
			);
			await runtime.dispose();
		},
	};
}

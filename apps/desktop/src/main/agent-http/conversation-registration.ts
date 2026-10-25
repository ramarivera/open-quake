import { Effect, Layer, ManagedRuntime } from "effect";
import { ipcMain, type WebContents } from "electron";
import {
	type ConversationResolver,
	ConversationRuntimePort,
	ConversationService,
} from "../../../../../packages/edge/src/agent-http/conversation-service.js";
import {
	AGENT_CONVERSATIONS_EVENT,
	AGENT_CONVERSATIONS_REQUEST,
} from "../../shared/agent-conversations.js";
import { agentRequestAllowed } from "../agents/controller.js";
import { createConversationController } from "./conversation-controller.js";

export interface ConversationWindow {
	readonly isDestroyed: () => boolean;
	readonly webContents: Pick<
		WebContents,
		"id" | "isDestroyed" | "getURL" | "send"
	>;
}
export interface RegisterAgentConversationsOptions {
	readonly management: () => ConversationWindow | undefined;
	readonly renderer: string;
	readonly resolve: ConversationResolver;
}
/** Lazy registration. Application composition owns this runtime and its disposal. */
export function registerAgentConversations(
	options: RegisterAgentConversationsOptions,
) {
	const runtime = ManagedRuntime.make(
		ConversationService.Default.pipe(
			Layer.provide(
				Layer.succeed(ConversationRuntimePort, { resolve: options.resolve }),
			),
		),
	);
	const controller = createConversationController({
		runtime,
		managementId: () => options.management()?.webContents.id,
		renderer: options.renderer,
		send: (source, event) => {
			const win = options.management();
			if (
				!win ||
				win.isDestroyed() ||
				win.webContents.isDestroyed() ||
				win.webContents.id !== source.senderId ||
				!agentRequestAllowed(
					{ ...source, frameURL: win.webContents.getURL() },
					win.webContents.id,
					options.renderer,
				)
			)
				return false;
			win.webContents.send(AGENT_CONVERSATIONS_EVENT, event);
			return true;
		},
	});
	const windows = new Map<number, () => void>();
	ipcMain.handle(AGENT_CONVERSATIONS_REQUEST, (event, input: unknown) => {
		const source = {
			senderId: event.sender.id,
			frameURL: event.senderFrame?.url ?? "",
			mainFrame: event.senderFrame === event.sender.mainFrame,
		};
		if (
			agentRequestAllowed(
				source,
				options.management()?.webContents.id,
				options.renderer,
			) &&
			!windows.has(source.senderId)
		) {
			const sender = event.sender;
			const cancel = (): void => {
				void controller.cancelOwner(source.senderId);
			};
			const destroyed = (): void => {
				cancel();
				windows.get(source.senderId)?.();
				windows.delete(source.senderId);
			};
			sender.on("did-start-navigation", cancel);
			sender.once("destroyed", destroyed);
			windows.set(source.senderId, () => {
				sender.removeListener("did-start-navigation", cancel);
				sender.removeListener("destroyed", destroyed);
			});
		}
		return controller.handle(source, input);
	});
	let disposed = false;
	return {
		runtime,
		dispose: async (): Promise<void> => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(AGENT_CONVERSATIONS_REQUEST);
			for (const off of windows.values()) off();
			windows.clear();
			await controller.dispose();
			await runtime.runPromise(
				Effect.flatMap(ConversationService, (service) => service.shutdown()),
			);
			await runtime.dispose();
		},
	};
}

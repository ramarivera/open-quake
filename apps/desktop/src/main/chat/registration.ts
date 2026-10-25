import { Exit, Scope } from "effect";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { CHAT_DISCONNECT, CHAT_EVENT, CHAT_REQUEST } from "../../shared/chat";
import { agentRequestAllowed } from "../agents/controller";
import type { DirectChat } from "./host";
import { decodeChatRequest, makeDesktopChatConnection } from "./rpc-server";

/** Only the current management and panel main frames can access the desktop chat. */
export function registerDirectChat(options: {
	readonly host: DirectChat;
	readonly management: () => BrowserWindow | undefined;
	readonly panel: () => BrowserWindow | undefined;
	readonly renderer: string;
}) {
	const clients = new Map<
		number,
		{
			readonly close: () => Promise<void>;
			readonly write: (input: unknown) => Promise<void>;
		}
	>();
	const pending = new Map<number, Promise<void>>();
	let disposed = false;
	const allowed = (event: IpcMainInvokeEvent) =>
		!disposed &&
		[options.management(), options.panel()].some(
			(win) =>
				win &&
				!win.isDestroyed() &&
				agentRequestAllowed(
					{
						senderId: event.sender.id,
						frameURL: event.senderFrame?.url ?? "",
						mainFrame: event.senderFrame === event.sender.mainFrame,
					},
					win.webContents.id,
					options.renderer,
				),
		);
	const disconnect = async (id: number) => {
		await pending.get(id)?.catch(() => undefined);
		const client = clients.get(id);
		clients.delete(id);
		await client?.close();
	};
	ipcMain.handle(CHAT_REQUEST, async (event, input: unknown) => {
		if (!allowed(event) || !decodeChatRequest(input))
			throw new Error("CHAT.IPC.UNAUTHORIZED");
		const id = event.sender.id;
		if (!clients.has(id) && !pending.has(id)) {
			const setup = (async () => {
				const scope = await options.host.runtime.runPromise(Scope.make());
				const sender = event.sender;
				const connection = await options.host.runtime.runPromise(
					makeDesktopChatConnection(options.host, (message) => {
						if (
							!disposed &&
							!sender.isDestroyed() &&
							agentRequestAllowed(
								{ senderId: id, frameURL: sender.getURL(), mainFrame: true },
								id,
								options.renderer,
							)
						)
							sender.send(CHAT_EVENT, message);
					}).pipe(Scope.extend(scope)),
				);
				const cancel = () => {
					void disconnect(id);
				};
				sender.on("did-start-navigation", cancel);
				sender.once("destroyed", cancel);
				clients.set(id, {
					write: (message) =>
						options.host.runtime.runPromise(connection.write(message)),
					close: async () => {
						sender.removeListener("did-start-navigation", cancel);
						sender.removeListener("destroyed", cancel);
						await options.host.runtime.runPromise(
							Scope.close(scope, Exit.void),
						);
					},
				});
			})();
			pending.set(id, setup);
			void setup.finally(() => pending.delete(id)).catch(() => undefined);
		}
		await pending.get(id);
		if (!allowed(event)) {
			await disconnect(id);
			throw new Error("CHAT.IPC.UNAUTHORIZED");
		}
		await clients.get(id)?.write(input);
	});
	ipcMain.handle(CHAT_DISCONNECT, async (event) => {
		if (allowed(event)) await disconnect(event.sender.id);
	});
	return {
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(CHAT_REQUEST);
			ipcMain.removeHandler(CHAT_DISCONNECT);
			await Promise.allSettled(pending.values());
			await Promise.all([...clients.keys()].map(disconnect));
		},
	};
}

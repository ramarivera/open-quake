import { Exit, Scope } from "effect";
import { type BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { CHAT_DISCONNECT, CHAT_EVENT, CHAT_REQUEST } from "../../shared/chat";
import { agentRequestAllowed } from "../agents/controller";
import type { DirectChat } from "./host";
import { decodeChatRequest, makeDesktopChatConnection } from "./rpc-server";

/** Only current trusted main frames can access chat. Each document owns its RPC scope. */
export function registerDirectChat(options: {
	readonly host: DirectChat;
	readonly management: () => BrowserWindow | undefined;
	readonly panel: () => BrowserWindow | undefined;
	readonly renderer: string;
}) {
	type Connection = {
		readonly write: (input: unknown) => Promise<void>;
		readonly close: () => Promise<void>;
		readonly ready: Promise<void>;
		revoked: boolean;
	};
	const clients = new Map<number, Connection>();
	const scopes = new Set<Connection>();
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
	const connect = (event: IpcMainInvokeEvent): Connection => {
		const sender = event.sender,
			id = sender.id,
			frame = event.senderFrame;
		let scope: Scope.CloseableScope | undefined;
		let write: ((input: unknown) => Promise<void>) | undefined;
		let closing: Promise<void> | undefined;
		const revoke = () => {
			client.revoked = true;
			if (clients.get(id) === client) clients.delete(id);
			sender.removeListener("did-start-navigation", navigating);
			sender.removeListener("destroyed", destroyed);
		};
		const destroyed = () => {
			void client.close().catch(() => undefined);
		};
		const navigating = (
			_event: unknown,
			_url: string,
			_inPlace: boolean,
			mainFrame: boolean,
		) => {
			if (mainFrame && !_inPlace) destroyed();
		};
		const client: Connection = {
			revoked: false,
			ready: Promise.resolve().then(async () => {
				if (client.revoked) return;
				scope = await options.host.runtime.runPromise(Scope.make());
				const connection = await options.host.runtime.runPromise(
					makeDesktopChatConnection(options.host, (message) => {
						if (
							!disposed &&
							!client.revoked &&
							!sender.isDestroyed() &&
							sender.mainFrame === frame &&
							agentRequestAllowed(
								{ senderId: id, frameURL: sender.getURL(), mainFrame: true },
								id,
								options.renderer,
							)
						)
							sender.send(CHAT_EVENT, message);
					}).pipe(Scope.extend(scope)),
				);
				write = (input) =>
					options.host.runtime.runPromise(connection.write(input));
			}),
			write: async (input) => {
				await client.ready;
				if (!client.revoked && !disposed) await write?.(input);
			},
			close: () => {
				// Revoke synchronously, before waiting for setup or cancellation. A reloaded
				// document must never reuse the preceding document's connection or replies.
				revoke();
				closing ??= (async () => {
					await client.ready.catch(() => undefined);
					try {
						if (scope)
							await options.host.runtime.runPromise(
								Scope.close(scope, Exit.void),
							);
					} finally {
						scopes.delete(client);
					}
				})();
				return closing;
			},
		};
		clients.set(id, client);
		scopes.add(client);
		sender.on("did-start-navigation", navigating);
		sender.once("destroyed", destroyed);
		return client;
	};
	ipcMain.handle(CHAT_REQUEST, async (event, input: unknown) => {
		if (!allowed(event) || !decodeChatRequest(input))
			throw new Error("CHAT.IPC.UNAUTHORIZED");
		const client = clients.get(event.sender.id) ?? connect(event);
		try {
			await client.ready;
			if (
				!allowed(event) ||
				client.revoked ||
				clients.get(event.sender.id) !== client
			) {
				await client.close();
				throw new Error("CHAT.IPC.UNAUTHORIZED");
			}
			await client.write(input);
		} catch (cause) {
			await client.close();
			throw cause;
		}
	});
	ipcMain.handle(CHAT_DISCONNECT, async (event) => {
		if (allowed(event)) await clients.get(event.sender.id)?.close();
	});
	return {
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			ipcMain.removeHandler(CHAT_REQUEST);
			ipcMain.removeHandler(CHAT_DISCONNECT);
			await Promise.all([...scopes].map((client) => client.close()));
		},
	};
}

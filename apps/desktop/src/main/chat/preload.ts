import {
	Context,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Queue,
	Schema,
	Stream,
} from "effect";
import { AiErrors } from "../../../../../packages/edge/src/ai/ai-errors";
import { ChatErrors } from "../../../../../packages/edge/src/chat/chat-errors";
import {
	ChatRpcFailure,
	ChatRpcs,
	type FromServerEncoded,
	RpcClient,
	RpcClientError,
} from "../../../../../packages/edge/src/chat/chat-rpc";
import {
	CHAT_DISCONNECT,
	CHAT_EVENT,
	CHAT_REQUEST,
	type DirectChatBridge,
} from "../../shared/chat";

type Client = RpcClient.FromGroup<
	typeof ChatRpcs,
	RpcClientError.RpcClientError
>;
class ClientTag extends Context.Tag("DesktopChatClient")<ClientTag, Client>() {}
export interface ChatRendererIPC {
	readonly invoke: (channel: string, input?: unknown) => Promise<unknown>;
	readonly on: (
		channel: string,
		listener: (event: unknown, input: unknown) => void,
	) => unknown;
	readonly removeListener: (
		channel: string,
		listener: (event: unknown, input: unknown) => void,
	) => unknown;
}
/** One encoded RPC client per preload world. No host owner or secret is accepted. */
export function createDirectChatBridge(
	ipc: ChatRendererIPC,
	options: { readonly disconnectOnDispose?: boolean } = {},
): DirectChatBridge {
	const runtime = ManagedRuntime.make(
		Layer.scopedContext(
			Effect.gen(function* () {
				const queue = yield* Queue.bounded<FromServerEncoded>(256);
				const listener = (_event: unknown, value: unknown) => {
					// The authenticated main process is the sole producer; RPC schemas decode results.
					if (typeof value === "object" && value !== null && "_tag" in value)
						Effect.runFork(Queue.offer(queue, value as FromServerEncoded));
				};
				ipc.on(CHAT_EVENT, listener);
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => ipc.removeListener(CHAT_EVENT, listener)),
				);
				const protocol = yield* RpcClient.Protocol.make((write) =>
					Effect.gen(function* () {
						yield* Stream.fromQueue(queue).pipe(
							Stream.runForEach(write),
							Effect.forkScoped,
						);
						return {
							supportsAck: true,
							supportsTransferables: false,
							send: (message) =>
								Effect.tryPromise({
									try: () => ipc.invoke(CHAT_REQUEST, message),
									catch: () =>
										new RpcClientError.RpcClientError({
											reason: "Protocol",
											message: "Chat transport unavailable",
										}),
								}).pipe(Effect.asVoid),
						};
					}),
				);
				const client = yield* RpcClient.make(ChatRpcs).pipe(
					Effect.provideService(RpcClient.Protocol, protocol),
				);
				return Context.make(ClientTag, client);
			}),
		),
	);
	// A scoped tag keeps the client and its transports alive until explicit disposal.
	const run = <A, E>(f: (client: Client) => Effect.Effect<A, E>) =>
		runtime
			.runPromise(Effect.flatMap(ClientTag, f).pipe(Effect.either))
			.then((result) => {
				if (result._tag === "Right") return result.right;
				const failure = result.left;
				const entry = Schema.is(ChatRpcFailure)(failure)
					? [...Object.values(ChatErrors), ...Object.values(AiErrors)].find(
							(entry) => entry.code === failure.code,
						)
					: undefined;
				// Error subclasses lose custom fields across Electron contextBridge.
				return Promise.reject(
					entry
						? {
								_tag: "ChatRpcFailure",
								code: entry.code,
								message: entry.message,
							}
						: {
								_tag: "ChatTransportUnavailable",
								code: "CHAT.TRANSPORT.UNAVAILABLE",
								message: "Chat transport unavailable",
							},
				);
			});
	let disposed = false;
	return {
		persona: {
			read: () => run((client) => client.assistant.read(undefined)),
			update: (settings) =>
				run((client) => client.assistant.update({ settings })),
		},
		assistantVisibility: (visible) =>
			run((client) => client.assistant.visibility({ visible })),
		selection: () => run((client) => client.assistant.selection(undefined)),
		acknowledgeSelection: (generation) =>
			run((client) => client.assistant.ack({ generation })),
		files: (input) => run((client) => client.provider.files(input)),
		providers: () => run((client) => client.provider.list(undefined)),
		submit: (input) => run((client) => client.chat.submit(input)),
		snapshot: (sessionId, turnId) =>
			run((client) => client.chat.snapshot({ sessionId, turnId })),
		cancel: (sessionId, turnId) =>
			run((client) => client.chat.cancel({ sessionId, turnId })),
		close: (sessionId) => run((client) => client.chat.close({ sessionId })),
		clear: (sessionId) => run((client) => client.chat.clear({ sessionId })),
		rename: (sessionId, title) =>
			run((client) => client.chat.rename({ sessionId, title })),
		history: (sessionId) => run((client) => client.chat.history({ sessionId })),
		list: () => run((client) => client.chat.list(undefined)),
		subscribe: (sessionId, turnId, callback, failed) => {
			const fiber = runtime.runFork(
				Effect.flatMap(ClientTag, (client) =>
					client.chat.subscribe({ sessionId, turnId }).pipe(
						Stream.runForEach((delivery) =>
							Effect.sync(() => callback(delivery)),
						),
						Effect.catchAll((error) =>
							Effect.sync(() =>
								failed(
									"code" in error ? error.code : "CHAT.TRANSPORT.UNAVAILABLE",
								),
							),
						),
					),
				),
			);
			return () => {
				if (!disposed) void runtime.runPromise(Fiber.interrupt(fiber));
			};
		},
		dispose: async () => {
			if (disposed) return;
			disposed = true;
			await runtime.dispose();
			if (options.disconnectOnDispose !== false)
				await ipc.invoke(CHAT_DISCONNECT);
		},
	};
}

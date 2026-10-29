import { Context, Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { MonitoringSnapshot } from "../../../../../packages/edge/src/monitor/monitor-config";
import {
	MonitoringRpcs,
	RpcClient,
	RpcClientError,
} from "../../../../../packages/edge/src/monitor/monitor-rpc";
import {
	MONITOR_STATE,
	MONITOR_STATE_REQUEST,
} from "../../shared/monitor-contracts";
import type { ChatRendererIPC } from "../chat/preload";

type Client = RpcClient.FromGroup<
	typeof MonitoringRpcs,
	RpcClientError.RpcClientError
>;
class ClientTag extends Context.Tag("DesktopMonitoringClient")<
	ClientTag,
	Client
>() {}
const Response = Schema.Struct({
	_tag: Schema.Literal("Exit"),
	requestId: Schema.String,
	exit: Schema.Struct({
		_tag: Schema.Literal("Success"),
		value: MonitoringSnapshot,
	}),
});
const protocolError = () =>
	new RpcClientError.RpcClientError({
		reason: "Protocol",
		message: "Monitoring transport unavailable",
	});
export function createMonitoringStateBridge(ipc: ChatRendererIPC) {
	const runtime = ManagedRuntime.make(
		Layer.scopedContext(
			Effect.gen(function* () {
				const protocol = yield* RpcClient.Protocol.make((write) =>
					Effect.succeed({
						supportsAck: false,
						supportsTransferables: false,
						send: (message) =>
							message._tag !== "Request"
								? Effect.void
								: Effect.tryPromise({
										try: () => ipc.invoke(MONITOR_STATE_REQUEST, message),
										catch: () =>
											new RpcClientError.RpcClientError({
												reason: "Protocol",
												message: "Monitoring transport unavailable",
											}),
									}).pipe(
										Effect.flatMap((response) => {
											const decoded =
												Schema.decodeUnknownOption(Response)(response);
											return Option.isSome(decoded) &&
												decoded.value.requestId === message.id
												? write(decoded.value)
												: Effect.fail(protocolError());
										}),
									),
					}),
				);
				const client = yield* RpcClient.make(MonitoringRpcs).pipe(
					Effect.provideService(RpcClient.Protocol, protocol),
				);
				return Context.make(ClientTag, client);
			}),
		),
	);
	const run = <A, E>(f: (client: Client) => Effect.Effect<A, E>) =>
		runtime
			.runPromise(
				Effect.flatMap(ClientTag, f).pipe(
					Effect.timeoutFail({
						duration: "2 seconds",
						onTimeout: protocolError,
					}),
					Effect.either,
				),
			)
			.then((result) =>
				result._tag === "Right"
					? result.right
					: Promise.reject({
							// Effect errors carry prototype/symbol state that contextBridge cannot clone.
							_tag: "RpcClientError",
							reason: "Protocol",
							message: "Monitoring transport unavailable",
						}),
			);
	const subscriptions = new Set<() => void>();
	return {
		snapshot: () =>
			run((client) => client.monitoring.snapshot({ _tag: "snapshot" })),
		subscribe: (receive: (snapshot: MonitoringSnapshot) => void) => {
			const listener = (_event: unknown, input: unknown) => {
				const result = Schema.decodeUnknownOption(MonitoringSnapshot)(input);
				if (result._tag === "Some") receive(result.value);
			};
			ipc.on(MONITOR_STATE, listener);
			const off = () => {
				ipc.removeListener(MONITOR_STATE, listener);
				subscriptions.delete(off);
			};
			subscriptions.add(off);
			return off;
		},
		dispose: async () => {
			for (const off of subscriptions) off();
			await runtime.dispose();
		},
	};
}

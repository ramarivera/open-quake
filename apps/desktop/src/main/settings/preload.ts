import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { LocaleSnapshot } from "../../../../../packages/edge/src/settings/settings-contracts";
import {
	type FromServerEncoded,
	RpcClient,
	RpcClientError,
	SettingsRpcs,
} from "../../../../../packages/edge/src/settings/settings-rpc";
import {
	type AppLocaleBridge,
	LOCALE_CHANGED,
	LOCALE_REQUEST,
} from "../../shared/locale";
import type { ChatRendererIPC } from "../chat/preload";

type Client = RpcClient.FromGroup<
	typeof SettingsRpcs,
	RpcClientError.RpcClientError
>;
class ClientTag extends Context.Tag("DesktopSettingsClient")<
	ClientTag,
	Client
>() {}
export function createAppLocaleBridge(ipc: ChatRendererIPC): AppLocaleBridge {
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
										try: () => ipc.invoke(LOCALE_REQUEST, message),
										catch: () =>
											new RpcClientError.RpcClientError({
												reason: "Protocol",
												message: "Settings transport unavailable",
											}),
									}).pipe(
										Effect.flatMap((response) =>
											write(response as FromServerEncoded),
										),
									),
					}),
				);
				const client = yield* RpcClient.make(SettingsRpcs).pipe(
					Effect.provideService(RpcClient.Protocol, protocol),
				);
				return Context.make(ClientTag, client);
			}),
		),
	);
	const run = <A, E>(f: (client: Client) => Effect.Effect<A, E>) =>
		runtime
			.runPromise(Effect.flatMap(ClientTag, f).pipe(Effect.either))
			.then((result) =>
				result._tag === "Right" ? result.right : Promise.reject(result.left),
			);
	const subscriptions = new Set<() => void>();
	return {
		read: () => run((client) => client.settings.locale(undefined)),
		set: (locale) => run((client) => client.settings.setLocale({ locale })),
		subscribe: (receive) => {
			const listener = (_event: unknown, input: unknown) => {
				const result = Schema.decodeUnknownOption(LocaleSnapshot)(input);
				if (result._tag === "Some") receive(result.value);
			};
			ipc.on(LOCALE_CHANGED, listener);
			const off = () => {
				ipc.removeListener(LOCALE_CHANGED, listener);
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

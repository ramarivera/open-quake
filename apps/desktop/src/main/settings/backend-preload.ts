import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { SettingsBackendRpcs } from "../../../../../packages/edge/src/settings/backend-rpc";
import { SettingsBackendFailure } from "../../../../../packages/edge/src/settings/settings-errors";
import {
	type FromServerEncoded,
	RpcClient,
	RpcClientError,
} from "../../../../../packages/edge/src/settings/settings-rpc";
import {
	SETTINGS_BACKEND_REQUEST,
	type SettingsBackendBridge,
} from "../../shared/settings-backend";
import type { ChatRendererIPC } from "../chat/preload";

type Client = RpcClient.FromGroup<
	typeof SettingsBackendRpcs,
	RpcClientError.RpcClientError
>;
class ClientTag extends Context.Tag("DesktopSettingsBackendClient")<
	ClientTag,
	Client
>() {}
export function createSettingsBackendBridge(
	ipc: ChatRendererIPC,
): SettingsBackendBridge {
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
										try: () => ipc.invoke(SETTINGS_BACKEND_REQUEST, message),
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
				const client = yield* RpcClient.make(SettingsBackendRpcs).pipe(
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
				result._tag === "Right"
					? result.right
					: Promise.reject(
							Schema.is(SettingsBackendFailure)(result.left)
								? {
										_tag: result.left._tag,
										code: result.left.code,
										...(result.left._tag === "SettingsOsApplyFailed"
											? { reason: result.left.reason }
											: {}),
									}
								: {
										_tag: "SettingsTransportUnavailable",
										code: "QUAKE.SETTINGS.UNAVAILABLE",
									},
						),
			);
	return {
		development: process.env.NODE_ENV === "development",
		wizardDebug:
			process.env.NODE_ENV === "development" &&
			process.env.OPEN_QUAKE_WIZARD_DEBUG === "1",
		general: () => run((client) => client.settings.general(undefined)),
		saveGeneral: (preferences) =>
			run((client) => client.settings.saveGeneral({ preferences })),
		loginStatus: () => run((client) => client.settings.loginStatus(undefined)),
		wizard: () => run((client) => client.wizard.snapshot(undefined)),
		saveWizard: (draft) => run((client) => client.wizard.save({ draft })),
		seedRegion: (region) =>
			run((client) => client.wizard.seedRegion({ region })),
		replayWizard: () => run((client) => client.wizard.replay(undefined)),
		completeWizard: () => run((client) => client.wizard.complete(undefined)),
		dispose: () => runtime.dispose(),
	};
}

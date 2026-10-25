import { Deferred, Effect, Mailbox, Option, Schema } from "effect";
import { SettingsBackendRpcs } from "../../../../../packages/edge/src/settings/backend-rpc";
import { GeneralSettingsService } from "../../../../../packages/edge/src/settings/general-service";
import {
	type FromClientEncoded,
	type FromServerEncoded,
	RpcServer,
} from "../../../../../packages/edge/src/settings/settings-rpc";
import { WizardService } from "../../../../../packages/edge/src/settings/wizard-service";

const Request = Schema.Struct({
	_tag: Schema.Literal("Request"),
	id: Schema.String.pipe(Schema.pattern(/^[0-9]{1,20}$/)),
	tag: Schema.String,
	payload: Schema.Unknown,
});
export function decodeSettingsBackendRequest(
	input: unknown,
): FromClientEncoded | undefined {
	const decoded = Schema.decodeUnknownOption(Request)(input);
	if (Option.isNone(decoded)) return;
	const value = decoded.value;
	const method = SettingsBackendRpcs.requests.get(value.tag);
	if (
		!method ||
		Option.isNone(
			Schema.decodeUnknownOption(
				Schema.make<unknown>(method.payloadSchema.ast),
				{ onExcessProperty: "error" },
			)(value.payload),
		)
	)
		return;
	return { ...value, headers: [] };
}
/** Each small unary call owns a scoped encoded RPC server, with no cross-document replies. */
export const handleSettingsBackendRequest = (message: FromClientEncoded) =>
	Effect.scoped(
		Effect.gen(function* () {
			const general = yield* GeneralSettingsService;
			const wizard = yield* WizardService;
			const done = yield* Deferred.make<FromServerEncoded>();

			const ready =
				yield* Deferred.make<
					(clientId: number, message: FromClientEncoded) => Effect.Effect<void>
				>();
			const protocol = yield* RpcServer.Protocol.make((write) =>
				Effect.gen(function* () {
					yield* Deferred.succeed(ready, write);
					return {
						disconnects: yield* Mailbox.make<number>(),
						send: (_id: number, response: FromServerEncoded) =>
							Deferred.succeed(done, response).pipe(Effect.asVoid),
						end: () => Effect.void,
						clientIds: Effect.succeed(new Set([1])),
						initialMessage: Effect.succeed(Option.none()),
						supportsAck: false,
						supportsTransferables: false,
						supportsSpanPropagation: false,
					};
				}),
			);

			yield* RpcServer.make(SettingsBackendRpcs, {
				concurrency: 1,
				disableFatalDefects: true,
			}).pipe(
				Effect.provide(
					SettingsBackendRpcs.toLayer({
						"settings.general": () => general.snapshot(),
						"settings.saveGeneral": ({ preferences }) =>
							general.save(preferences),
						"settings.loginStatus": () => general.loginStatus(),
						"wizard.snapshot": () => wizard.snapshot(),
						"wizard.save": ({ draft }) => wizard.save(draft),
						"wizard.seedRegion": ({ region }) => wizard.seedRegion(region),
						"wizard.replay": () => wizard.replay(),
						"wizard.complete": () => wizard.complete(),
					}),
				),
				Effect.provideService(RpcServer.Protocol, protocol),
				Effect.forkScoped,
			);
			const write = yield* Deferred.await(ready);
			yield* write(1, message);
			return yield* Deferred.await(done);
		}),
	);

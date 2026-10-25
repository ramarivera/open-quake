import { Deferred, Effect, Mailbox, Option, Schema } from "effect";
import {
	type FromClientEncoded,
	type FromServerEncoded,
	RpcServer,
	SettingsRpcs,
} from "../../../../../packages/edge/src/settings/settings-rpc";
import { SettingsService } from "../../../../../packages/edge/src/settings/settings-service";

const Request = Schema.Struct({
	_tag: Schema.Literal("Request"),
	id: Schema.String.pipe(Schema.pattern(/^[0-9]{1,20}$/)),
	tag: Schema.Literal("settings.locale", "settings.setLocale"),
	payload: Schema.Unknown,
});
export function decodeLocaleRequest(
	input: unknown,
): FromClientEncoded | undefined {
	const decoded = Schema.decodeUnknownOption(Request)(input);
	if (Option.isNone(decoded)) return;
	const value = decoded.value;
	const method = SettingsRpcs.requests.get(value.tag);
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
export const handleLocaleRequest = (message: FromClientEncoded) =>
	Effect.scoped(
		Effect.gen(function* () {
			const service = yield* SettingsService;
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

			yield* RpcServer.make(SettingsRpcs, {
				concurrency: 1,
				disableFatalDefects: true,
			}).pipe(
				Effect.provide(
					SettingsRpcs.toLayer({
						"settings.locale": () => service.locale(),
						"settings.setLocale": ({ locale }) => service.setLocale(locale),
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

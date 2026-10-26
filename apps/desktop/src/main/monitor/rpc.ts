import { Deferred, Effect, Mailbox, Option, Schema } from "effect";
import {
	type FromClientEncoded,
	type FromServerEncoded,
	MonitoringRpcs,
	RpcServer,
} from "../../../../../packages/edge/src/monitor/monitor-rpc";
import { MonitoringService } from "../../../../../packages/edge/src/monitor/monitoring-service";

const Request = Schema.Struct({
	_tag: Schema.Literal("Request"),
	id: Schema.String.pipe(Schema.pattern(/^[0-9]{1,20}$/)),
	tag: Schema.Literal("monitoring.snapshot"),
	payload: Schema.Unknown,
});
export function decodeMonitoringRequest(
	input: unknown,
): FromClientEncoded | undefined {
	const decoded = Schema.decodeUnknownOption(Request)(input);
	if (Option.isNone(decoded)) return;
	const value = decoded.value;
	const method = MonitoringRpcs.requests.get(value.tag);
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
export const handleMonitoringRequest = (message: FromClientEncoded) =>
	Effect.scoped(
		Effect.gen(function* () {
			const service = yield* MonitoringService;
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

			yield* RpcServer.make(MonitoringRpcs, {
				concurrency: 1,
				disableFatalDefects: true,
			}).pipe(
				Effect.provide(
					MonitoringRpcs.toLayer({
						"monitoring.snapshot": () => service.snapshot(),
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

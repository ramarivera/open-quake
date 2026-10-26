import { Effect, Mailbox, Option, Schema, Stream } from "effect";
import type {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import { ChatInvalid } from "../../../../../packages/edge/src/chat/chat-errors";
import {
	ChatRpcs,
	type FromClientEncoded,
	type FromServerEncoded,
	RpcServer,
} from "../../../../../packages/edge/src/chat/chat-rpc";
import { type DirectChat, rpcFailure } from "./host";

const id = Schema.String.pipe(Schema.pattern(/^[0-9]{1,20}$/));
const WireRequest = Schema.Union(
	Schema.Struct({
		_tag: Schema.Literal("Request"),
		id,
		tag: Schema.String.pipe(Schema.maxLength(64)),
		payload: Schema.Unknown,
		headers: Schema.Array(
			Schema.Tuple(
				Schema.String.pipe(Schema.maxLength(128)),
				Schema.String.pipe(Schema.maxLength(1024)),
			),
		).pipe(Schema.maxItems(16)),
	}),
	Schema.Struct({ _tag: Schema.Literal("Ack", "Interrupt"), requestId: id }),
	Schema.Struct({ _tag: Schema.Literal("Eof", "Ping") }),
);
/** Preload envelopes carry no authority, remote trace IDs or headers into the host. */
export function decodeChatRequest(
	input: unknown,
): FromClientEncoded | undefined {
	const decoded = Schema.decodeUnknownEither(WireRequest)(input);
	if (decoded._tag === "Left") return undefined;
	const value = decoded.right;
	if (value._tag !== "Request") return value;
	const method = ChatRpcs.requests.get(value.tag);
	if (!method) return undefined;
	// Validate each method before any main-process request queue or fiber is allocated.
	if (
		Schema.decodeUnknownEither(Schema.make<unknown>(method.payloadSchema.ast), {
			onExcessProperty: "error",
		})(value.payload)._tag === "Left"
	)
		return undefined;
	return {
		_tag: "Request",
		id: value.id,
		tag: value.tag,
		payload: value.payload,
		headers: [],
	};
}
/** Each window owns a bounded RPC connection, using the real encoded Effect RPC protocol. */
export const makeDesktopChatConnection = (
	host: DirectChat,
	send: (message: FromServerEncoded) => void,
) =>
	Effect.gen(function* () {
		const owned = new Map<SessionId, TurnId>();
		const handlers = ChatRpcs.toLayer({
			"provider.files": (input) =>
				host.file(input).pipe(Effect.mapError(rpcFailure)),
			"provider.list": () => host.providers().pipe(Effect.mapError(rpcFailure)),
			"chat.submit": (input) =>
				host.submit(input).pipe(
					Effect.tap(() =>
						Effect.sync(() => owned.set(input.sessionId, input.turnId)),
					),
					Effect.map((turn) => turn.snapshot),
					Effect.mapError(rpcFailure),
				),
			"chat.subscribe": (input) =>
				Stream.unwrap(
					host.subscribe(input.sessionId, input.turnId).pipe(
						Effect.map((subscription) =>
							Stream.concat(
								Stream.succeed({
									_tag: "snapshot" as const,
									snapshot: subscription.snapshot,
								}),
								subscription.events.pipe(
									Stream.map((chunk) => ({ _tag: "chunk" as const, chunk })),
								),
							),
						),
					),
				).pipe(Stream.mapError(rpcFailure)),
			"chat.snapshot": (input) =>
				host
					.snapshot(input.sessionId, input.turnId)
					.pipe(Effect.mapError(rpcFailure)),
			"chat.cancel": (input) =>
				(owned.get(input.sessionId) === input.turnId
					? host.cancel(input.sessionId, input.turnId)
					: Effect.fail(new ChatInvalid())
				).pipe(Effect.mapError(rpcFailure)),
			"chat.close": (input) =>
				host.close(input.sessionId).pipe(Effect.mapError(rpcFailure)),
			"chat.clear": (input) =>
				host.clear(input.sessionId).pipe(Effect.mapError(rpcFailure)),
			"chat.rename": (input) =>
				host
					.rename(input.sessionId, input.title)
					.pipe(Effect.mapError(rpcFailure)),
			"chat.history": (input) =>
				host.history(input.sessionId).pipe(Effect.mapError(rpcFailure)),
			"chat.list": () => host.list().pipe(Effect.mapError(rpcFailure)),
		});
		let write:
			| ((clientId: number, message: FromClientEncoded) => Effect.Effect<void>)
			| undefined;
		const protocol = yield* RpcServer.Protocol.make((receiver) =>
			Effect.gen(function* () {
				write = receiver;
				return {
					disconnects: yield* Mailbox.make<number>(),
					send: (_clientId: number, message: FromServerEncoded) =>
						Effect.sync(() => send(message)),
					end: () => Effect.void,
					clientIds: Effect.succeed(new Set([1])),
					initialMessage: Effect.succeed(Option.none()),
					supportsAck: true,
					supportsTransferables: false,
					supportsSpanPropagation: false,
				};
			}),
		);
		yield* RpcServer.make(ChatRpcs, {
			concurrency: 8,
			disableFatalDefects: true,
		}).pipe(
			Effect.provide(handlers),
			Effect.provideService(RpcServer.Protocol, protocol),
			Effect.forkScoped,
		);
		yield* Effect.addFinalizer(() =>
			Effect.forEach(
				owned,
				([sessionId, turnId]) =>
					host.cancel(sessionId, turnId).pipe(Effect.ignore),
				{ discard: true },
			),
		);
		return {
			write: (input: unknown) => {
				const message = decodeChatRequest(input);
				return message && write ? write(1, message) : Effect.void;
			},
		};
	});

import { createHash, randomUUID } from "node:crypto";
import { Redacted, Schema } from "effect";
import type { ObsConnection, ObsConnectionConfig } from "./obs-contracts.js";
import {
	ObsAuthenticationFailed,
	type ObsError,
	ObsNetworkFailed,
	ObsRequestFailed,
	ObsRpcUnsupported,
	ObsSessionInvalidated,
} from "./obs-errors.js";

const record = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const Frame = Schema.Struct({ op: Schema.Int, d: record });
const Hello = Schema.Struct({
	rpcVersion: Schema.Int,
	authentication: Schema.optional(
		Schema.Struct({ challenge: Schema.String, salt: Schema.String }),
	),
});
export const obsAuthentication = (
	password: string,
	salt: string,
	challenge: string,
): string => {
	const secret = createHash("sha256")
		.update(password + salt)
		.digest("base64");
	return createHash("sha256")
		.update(secret + challenge)
		.digest("base64");
};
/** Native WebSocket handles framing. Remote comments/reasons never enter exceptions. */
export function openObsConnection(
	config: ObsConnectionConfig,
	password: Redacted.Redacted<string>,
	signal: AbortSignal,
): Promise<ObsConnection> {
	return new Promise((resolve, reject) => {
		let ready = false,
			finished = false,
			closed = false,
			transition = false;
		let terminalError: ObsError | undefined;
		const pending = new Map<
			string,
			{
				readonly resolve: (data: Record<string, unknown>) => void;
				readonly reject: (error: ObsError) => void;
				readonly cleanup: () => void;
			}
		>();
		const ws = new WebSocket(`ws://${config.host}:${config.port}`);
		const rejectPending = () => {
			for (const item of pending.values()) {
				item.cleanup();
				item.reject(terminalError ?? new ObsNetworkFailed());
			}
			pending.clear();
		};
		const close = () => {
			if (closed) return;
			closed = true;
			rejectPending();
			ws.close();
		};
		const fail = (error: ObsError) => {
			if (!finished) {
				finished = true;
				clearTimeout(handshake);
				signal.removeEventListener("abort", abort);
				reject(error);
			}
			close();
		};
		const abort = () => fail(new ObsNetworkFailed());
		const handshake = setTimeout(() => fail(new ObsNetworkFailed()), 10_000);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}
		ws.addEventListener("error", () => fail(new ObsNetworkFailed()));
		ws.addEventListener("close", (event) => {
			if (event.code === 4011) terminalError = new ObsSessionInvalidated();
			if (!finished)
				fail(
					terminalError ??
						(event.code === 4009
							? new ObsAuthenticationFailed()
							: new ObsNetworkFailed()),
				);
			closed = true;
			rejectPending();
		});
		ws.addEventListener("message", (event) => {
			if (closed) return;
			if (typeof event.data !== "string" || event.data.length > 3_000_000) {
				fail(new ObsNetworkFailed());
				return;
			}
			const decoded = Schema.decodeUnknownEither(Schema.parseJson(Frame))(
				event.data,
			);
			if (decoded._tag === "Left") {
				fail(new ObsNetworkFailed());
				return;
			}
			const { op, d } = decoded.right;
			if (op === 0) {
				if (finished) {
					fail(new ObsNetworkFailed());
					return;
				}
				const hello = Schema.decodeUnknownEither(Hello)(d);
				if (hello._tag === "Left" || hello.right.rpcVersion < 1) {
					fail(new ObsRpcUnsupported());
					return;
				}
				const auth = hello.right.authentication;
				ws.send(
					JSON.stringify({
						op: 1,
						d: {
							rpcVersion: 1,
							eventSubscriptions: 4095,
							...(auth
								? {
										authentication: obsAuthentication(
											Redacted.value(password),
											auth.salt,
											auth.challenge,
										),
									}
								: {}),
						},
					}),
				);
			} else if (op === 2) {
				if (finished) return;
				if (d.negotiatedRpcVersion !== 1) {
					fail(new ObsRpcUnsupported());
					return;
				}
				finished = true;
				ready = true;
				clearTimeout(handshake);
				signal.removeEventListener("abort", abort);
				resolve({
					connected: () => ready && !closed,
					terminalError: () => terminalError,
					transitioning: () => transition,
					close,
					request: (type, data = {}, requestSignal) =>
						new Promise((ok, no) => {
							if (closed || !ready || requestSignal?.aborted) {
								no(terminalError ?? new ObsNetworkFailed());
								return;
							}
							const id = randomUUID();
							const cancel = () => {
								pending.get(id)?.cleanup();
								pending.delete(id);
								no(new ObsNetworkFailed());
							};
							const timer = setTimeout(() => {
								pending.get(id)?.cleanup();
								pending.delete(id);
								no(new ObsNetworkFailed());
							}, 10_000);
							const cleanup = () => {
								clearTimeout(timer);
								requestSignal?.removeEventListener("abort", cancel);
							};
							pending.set(id, { resolve: ok, reject: no, cleanup });
							requestSignal?.addEventListener("abort", cancel, { once: true });
							try {
								ws.send(
									JSON.stringify({
										op: 6,
										d: { requestType: type, requestId: id, requestData: data },
									}),
								);
							} catch {
								cleanup();
								pending.delete(id);
								no(new ObsNetworkFailed());
							}
						}),
				});
			} else if (op === 7 && typeof d.requestId === "string") {
				const item = pending.get(d.requestId);
				if (!item) return;
				item.cleanup();
				pending.delete(d.requestId);
				const status = Schema.decodeUnknownEither(
					Schema.Struct({ result: Schema.Boolean, code: Schema.Int }),
				)(d.requestStatus);
				const response = Schema.decodeUnknownEither(record)(
					d.responseData ?? {},
				);
				if (
					status._tag === "Right" &&
					status.right.result &&
					status.right.code === 100 &&
					response._tag === "Right"
				)
					item.resolve(response.right);
				else item.reject(new ObsRequestFailed());
			} else if (op === 5) {
				if (d.eventType === "SceneTransitionStarted") transition = true;
				if (d.eventType === "SceneTransitionEnded") transition = false;
			}
		});
	});
}

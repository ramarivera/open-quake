import { Effect, Layer, Option, Redacted, Stream } from "effect";
import {
	RuntimeConnectionInvalid,
	type RuntimeError,
	RuntimeLimitExceeded,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
	RuntimeTimeout,
	RuntimeUnavailable,
} from "./runtime-errors.js";
import { resolveRuntimeURL } from "./runtime-invariants.js";
import {
	RuntimeHttpPort,
	type RuntimeHttpRequest,
	type RuntimeHttpResponse,
	type RuntimeHttpTransport,
} from "./runtime-ports.js";

import { checkedLimits, responseLimits } from "./transport-limits.js";

const prepare = (request: RuntimeHttpRequest) => {
	const url = resolveRuntimeURL(request.connection.baseURL, request.path);
	if (!url) throw new RuntimeConnectionInvalid();
	const limits = checkedLimits(request);
	const headers = new Headers();
	for (const [key, value] of Object.entries(request.headers ?? {})) {
		if (
			/^(authorization|proxy-authorization|host|cookie|set-cookie|connection|content-length|transfer-encoding|upgrade|trailer)$/i.test(
				key,
			)
		)
			throw new RuntimeConnectionInvalid();
		headers.set(key, value);
	}
	if (request.credential) {
		const credential = Redacted.value(request.credential);
		if (!/^[\x21-\x7e]+$/.test(credential))
			throw new RuntimeConnectionInvalid();
		headers.set("Authorization", `Bearer ${credential}`);
	}
	let body: string | undefined;
	if (request.body !== undefined) {
		if (request.method !== "POST") throw new RuntimeConnectionInvalid();
		body = JSON.stringify(request.body);
		if (body === undefined) throw new RuntimeConnectionInvalid();
		if (!headers.has("content-type"))
			headers.set("content-type", "application/json");
	}
	return { url, limits, headers, body };
};
/** One dispatch, no retries. Scope and stream completion both physically abort IO. */
export function makeRuntimeHttpTransport(
	fetcher: typeof globalThis.fetch = globalThis.fetch,
): RuntimeHttpTransport {
	return {
		execute: Effect.fn("RuntimeHttpTransport.execute")(function* (
			request: RuntimeHttpRequest,
		) {
			const prepared = yield* Effect.try({
				try: () => prepare(request),
				catch: (cause) =>
					cause instanceof RuntimeConnectionInvalid
						? cause
						: new RuntimeConnectionInvalid(cause),
			});
			const state = yield* Effect.acquireRelease(
				Effect.sync(() => {
					const controller = new AbortController();
					let timedOut = false;
					const cancel = () => controller.abort(request.signal?.reason);
					if (request.signal?.aborted) cancel();
					else
						request.signal?.addEventListener("abort", cancel, { once: true });
					const timer = setTimeout(() => {
						timedOut = true;
						controller.abort();
					}, prepared.limits.timeoutMs);
					return {
						controller,
						failure: (cause: unknown): RuntimeError =>
							timedOut
								? new RuntimeTimeout(cause)
								: controller.signal.aborted
									? new RuntimeRequestFailed(cause)
									: new RuntimeUnavailable(cause),
						close: () => {
							clearTimeout(timer);
							request.signal?.removeEventListener("abort", cancel);
							controller.abort();
						},
					};
				}),
				(state) => Effect.sync(state.close),
			);
			const response = yield* Effect.tryPromise({
				try: (signal) => {
					const abort = () => state.controller.abort();
					signal.addEventListener("abort", abort, { once: true });
					return fetcher(prepared.url, {
						method: request.method,
						headers: prepared.headers,
						redirect: "error",
						credentials: "omit",
						cache: "no-store",
						signal: state.controller.signal,
						...(prepared.body === undefined ? {} : { body: prepared.body }),
					}).finally(() => signal.removeEventListener("abort", abort));
				},
				catch: state.failure,
			});
			if (
				response.redirected ||
				(response.status >= 300 && response.status < 400)
			) {
				state.close();
				yield* Effect.promise(
					() =>
						response.body?.cancel().catch(() => undefined) ?? Promise.resolve(),
				);
				return yield* Effect.fail(new RuntimeProtocolInvalid());
			}
			const source = response.body;
			const body = source
				? Stream.unwrapScoped(
						Effect.gen(function* () {
							const reader = yield* Effect.acquireRelease(
								Effect.try({
									try: () => source.getReader(),
									catch: (cause) => new RuntimeProtocolInvalid(cause),
								}),
								(reader) =>
									Effect.promise(async () => {
										state.close();
										try {
											await reader.cancel();
										} catch {
										} finally {
											reader.releaseLock();
										}
									}),
							);
							let bytes = 0;
							return Stream.repeatEffectOption(
								Effect.gen(function* () {
									if (state.controller.signal.aborted)
										return yield* Effect.fail(
											Option.some(
												state.failure(state.controller.signal.reason),
											),
										);
									const next = yield* Effect.tryPromise({
										try: () => reader.read(),
										catch: (cause) => Option.some(state.failure(cause)),
									});
									if (state.controller.signal.aborted)
										return yield* Effect.fail(
											Option.some(
												state.failure(state.controller.signal.reason),
											),
										);
									if (next.done) return yield* Effect.fail(Option.none());
									bytes += next.value.byteLength;
									const limit = response.ok
										? prepared.limits.maxResponseBytes
										: Math.min(
												prepared.limits.maxResponseBytes,
												prepared.limits.maxErrorBytes,
											);
									if (bytes > limit)
										return yield* Effect.fail(
											Option.some(new RuntimeLimitExceeded()),
										);
									return next.value;
								}),
							);
						}),
					)
				: Stream.empty;
			const responseHeaders: Record<string, string> = {};
			response.headers.forEach((value, key) => {
				responseHeaders[key] = value;
			});
			const output: RuntimeHttpResponse = {
				status: response.status,
				headers: responseHeaders,
				body,
			};
			responseLimits.set(output, prepared.limits);
			return output;
		}),
	};
}
export const RuntimeHttpTransportLive = Layer.succeed(
	RuntimeHttpPort,
	makeRuntimeHttpTransport(),
);

export { parseSse, readJson, type SseEvent } from "./transport-decode.js";
export { DEFAULT_HTTP_LIMITS } from "./transport-limits.js";

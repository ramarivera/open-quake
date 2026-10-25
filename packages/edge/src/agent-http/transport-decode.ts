import { Effect, Stream } from "effect";
import {
	RuntimeAuthenticationFailed,
	RuntimeConnectionInvalid,
	type RuntimeError,
	RuntimeLimitExceeded,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
} from "./runtime-errors.js";
import type {
	RuntimeHttpLimits,
	RuntimeHttpResponse,
} from "./runtime-ports.js";
import {
	checkedLimits,
	type Limits,
	responseLimits,
} from "./transport-limits.js";
import { makeSseParser, type SseEvent } from "./transport-sse.js";

function limitsFor(
	response: RuntimeHttpResponse,
	overrides: RuntimeHttpLimits,
): Limits {
	return checkedLimits({ ...responseLimits.get(response), ...overrides });
}
function success(
	response: RuntimeHttpResponse,
): Effect.Effect<void, RuntimeError> {
	if (response.status === 401 || response.status === 403)
		return Effect.fail(
			new RuntimeAuthenticationFailed({ status: response.status }),
		);
	return response.status >= 200 && response.status < 300
		? Effect.void
		: Effect.fail(new RuntimeRequestFailed({ status: response.status }));
}
function contentType(response: RuntimeHttpResponse): string {
	const entry = Object.entries(response.headers).find(
		([key]) => key.toLowerCase() === "content-type",
	);
	return entry?.[1].split(";")[0]?.trim().toLowerCase() ?? "";
}
function boundedBytes(
	response: RuntimeHttpResponse,
	limits: Limits,
): Stream.Stream<Uint8Array, RuntimeError> {
	return Stream.suspend(() => {
		let bytes = 0;
		const limit =
			response.status >= 200 && response.status < 300
				? limits.maxResponseBytes
				: Math.min(limits.maxResponseBytes, limits.maxErrorBytes);
		return response.body.pipe(
			Stream.mapEffect((chunk) => {
				bytes += chunk.byteLength;
				return bytes > limit
					? Effect.fail(new RuntimeLimitExceeded())
					: Effect.succeed(chunk);
			}),
		);
	});
}
/** Fatal UTF-8 and JSON validation; provider-specific Schema decoding remains in the adapter. */
export const readJson = Effect.fn("RuntimeHttpTransport.readJson")(function* (
	response: RuntimeHttpResponse,
	overrides: RuntimeHttpLimits = {},
): Effect.fn.Return<unknown, RuntimeError> {
	yield* success(response);
	if (
		!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(
			contentType(response),
		)
	)
		return yield* Effect.fail(new RuntimeProtocolInvalid());
	const limits = yield* Effect.try({
		try: () => limitsFor(response, overrides),
		catch: (cause) =>
			cause instanceof RuntimeConnectionInvalid
				? cause
				: new RuntimeConnectionInvalid(cause),
	});
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const text = yield* boundedBytes(response, limits).pipe(
		Stream.runFoldEffect("", (text, chunk) =>
			Effect.try({
				try: () => text + decoder.decode(chunk, { stream: true }),
				catch: (cause) => new RuntimeProtocolInvalid(cause),
			}),
		),
	);
	return yield* Effect.try({
		try: (): unknown => JSON.parse(text + decoder.decode()),
		catch: (cause) => new RuntimeProtocolInvalid(cause),
	});
});
/** SSE framing only. Incomplete trailing events are discarded per the SSE protocol. */
export function parseSse(
	response: RuntimeHttpResponse,
	overrides: RuntimeHttpLimits = {},
): Stream.Stream<SseEvent, RuntimeError> {
	return Stream.unwrap(
		Effect.gen(function* () {
			yield* success(response);
			if (contentType(response) !== "text/event-stream")
				return yield* Effect.fail(new RuntimeProtocolInvalid());
			const limits = yield* Effect.try({
				try: () => limitsFor(response, overrides),
				catch: (cause) =>
					cause instanceof RuntimeConnectionInvalid
						? cause
						: new RuntimeConnectionInvalid(cause),
			});
			const parser = makeSseParser(limits.maxEventBytes);
			const convert = (cause: unknown) =>
				cause instanceof RuntimeLimitExceeded
					? cause
					: new RuntimeProtocolInvalid(cause);
			return boundedBytes(response, limits).pipe(
				Stream.mapConcatEffect((chunk) =>
					Effect.try({ try: () => parser.feed(chunk), catch: convert }),
				),
				Stream.concat(
					Stream.unwrap(
						Effect.try({
							try: () => Stream.fromIterable(parser.finish()),
							catch: convert,
						}),
					),
				),
			);
		}),
	);
}
export type { SseEvent } from "./transport-sse.js";

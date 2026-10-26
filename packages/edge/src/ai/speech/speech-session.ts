import { Clock, Effect, Schema, Stream } from "effect";
import { type AiError, AiProtocolInvalid } from "../ai-errors.js";
import { SpeechPhaseTimeout } from "./speech-errors.js";
import type { SpeechSocket, SpeechWebSocket } from "./speech-ports.js";

export const receiveObject = (socket: SpeechSocket) =>
	socket.receive.pipe(
		Effect.flatMap((raw) =>
			(typeof raw === "string"
				? Schema.decodeUnknown(
						Schema.parseJson(
							Schema.Record({ key: Schema.String, value: Schema.Unknown }),
						),
					)(raw)
				: Schema.decodeUnknown(
						Schema.Record({ key: Schema.String, value: Schema.Unknown }),
					)(raw)
			).pipe(Effect.mapError((cause) => new AiProtocolInvalid(cause))),
		),
	);
export const object = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
export const sendEvent = (socket: SpeechSocket, event: object) =>
	socket.send(JSON.stringify(event));
export const phase = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
	name: "connect" | "configure" | "capture" | "final",
	ms = name === "final" ? 15000 : 10000,
) =>
	effect.pipe(
		Effect.timeoutFail({
			duration: ms,
			onTimeout: () => new SpeechPhaseTimeout(name),
		}),
	);
export function withSocket<A, E, R>(
	transport: typeof SpeechWebSocket.Service,
	url: string,
	headers: Readonly<Record<string, string>>,
	use: (socket: SpeechSocket) => Effect.Effect<A, E, R>,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const controller = new AbortController();
			yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
			const socket = yield* Effect.acquireRelease(
				phase(
					transport
						.connect({ url, headers, signal: controller.signal })
						.pipe(Effect.interruptible),
					"connect",
				),
				(s) => s.close,
			);
			return yield* use(socket);
		}),
	);
}
/** One shared bound for every streaming provider, including a blocked send. */
export function sendFrames(
	frames: Stream.Stream<Uint8Array, AiError>,
	send: (
		bytes: Uint8Array,
	) => Effect.Effect<void, AiError | SpeechPhaseTimeout>,
) {
	return Effect.gen(function* () {
		const deadline = (yield* Clock.currentTimeMillis) + 60000;
		let count = 0;
		yield* Stream.runForEach(
			frames.pipe(Stream.interruptAfter("60 seconds")),
			(bytes) =>
				Effect.gen(function* () {
					if (!bytes.length || bytes.length > 960 || bytes.length % 2)
						return yield* new AiProtocolInvalid();
					if (++count > 3001) return yield* new AiProtocolInvalid();
					yield* phase(
						send(bytes),
						"capture",
						Math.max(0, deadline - (yield* Clock.currentTimeMillis)),
					);
				}),
		);
		return count;
	});
}
export function decodeAudio(
	value: unknown,
): Effect.Effect<Uint8Array, AiProtocolInvalid> {
	return Effect.try({
		try: () => {
			if (
				typeof value !== "string" ||
				value.length > 8_000_000 ||
				!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
					value,
				)
			)
				throw new Error("Invalid base64");
			return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
		},
		catch: (cause) => new AiProtocolInvalid(cause),
	});
}
export const encodeAudio = (bytes: Uint8Array) =>
	btoa(Array.from(bytes, (c) => String.fromCharCode(c)).join(""));

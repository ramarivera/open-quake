import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";
import { Effect } from "effect";
import {
	type AiError,
	AiProtocolInvalid,
	AiUnavailable,
	translateProviderFailure,
} from "../../../../../packages/edge/src/ai/ai-errors";
import type {
	SpeechSocket,
	SpeechWebSocket,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";

const LIMIT = 1024 * 1024;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
/** Client frames are always masked; server masking, extensions and oversized messages fail closed. */
export function clientFrame(opcode: number, data: Uint8Array): Buffer {
	const mask = randomBytes(4);
	const header = data.length < 126 ? 2 : 4;
	const frame = Buffer.alloc(header + 4 + data.length);
	frame[0] = 0x80 | opcode;
	frame[1] = 0x80 | (header === 2 ? data.length : 126);
	if (header === 4) frame.writeUInt16BE(data.length, 2);
	mask.copy(frame, header);
	for (let index = 0; index < data.length; index++)
		frame[header + 4 + index] = (data[index] ?? 0) ^ (mask[index % 4] ?? 0);
	return frame;
}
export interface SocketConnectInput {
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly signal: AbortSignal;
}
export function connectSpeechSocket(
	input: SocketConnectInput,
	allowLoopback = false,
): Effect.Effect<SpeechSocket, AiError> {
	return Effect.async<SpeechSocket, AiError>((resume) => {
		let url: URL;
		try {
			url = new URL(input.url);
		} catch (cause) {
			resume(Effect.fail(new AiUnavailable(cause)));
			return;
		}
		const local =
			allowLoopback &&
			url.protocol === "ws:" &&
			(url.hostname === "127.0.0.1" || url.hostname === "localhost");
		if (
			(!local && url.protocol !== "wss:") ||
			url.username ||
			url.password ||
			url.hash ||
			input.signal.aborted
		) {
			resume(Effect.fail(new AiUnavailable()));
			return;
		}
		url.protocol = local ? "http:" : "https:";
		const key = randomBytes(16).toString("base64");
		let stream: Duplex | undefined;
		let failure: AiError | undefined;
		let pending:
			| ((effect: Effect.Effect<unknown, AiError>) => void)
			| undefined;
		let buffer: Buffer = Buffer.alloc(0);
		let fragmented: Buffer[] = [];
		let fragmentBytes = 0;
		const queue: string[] = [];
		let queuedBytes = 0;
		let opened = false;
		const request = (local ? httpRequest : httpsRequest)(url, {
			headers: {
				...input.headers,
				Connection: "Upgrade",
				Upgrade: "websocket",
				"Sec-WebSocket-Version": "13",
				"Sec-WebSocket-Key": key,
			},
		});
		const close = () => {
			input.signal.removeEventListener("abort", abort);
			request.destroy();
			stream?.destroy();
			buffer = Buffer.alloc(0);
			fragmented = [];
			queue.length = 0;
			queuedBytes = 0;
		};
		const fail = (error: AiError, drain = false) => {
			if (failure) return;
			failure = error;
			if (!opened) resume(Effect.fail(error));
			const waiter = pending;
			pending = undefined;
			waiter?.(Effect.fail(error));
			const remaining = drain ? [...queue] : [];
			close();
			queue.push(...remaining);
			queuedBytes = remaining.reduce(
				(sum, value) => sum + Buffer.byteLength(value),
				0,
			);
		};
		const abort = () => fail(new AiUnavailable());
		input.signal.addEventListener("abort", abort, { once: true });
		request.on("error", (cause) => fail(new AiUnavailable(cause)));
		request.on("response", (response) => {
			response.resume();
			fail(translateProviderFailure(response.statusCode, undefined));
		});
		request.on("upgrade", (response, socket, head) => {
			stream = socket;
			const expected = createHash("sha1")
				.update(key + GUID)
				.digest("base64");
			if (
				response.statusCode !== 101 ||
				response.headers["sec-websocket-accept"] !== expected ||
				response.headers.upgrade?.toLowerCase() !== "websocket" ||
				response.headers["sec-websocket-extensions"] ||
				response.headers["sec-websocket-protocol"]
			) {
				fail(new AiProtocolInvalid());
				return;
			}
			const message = (bytes: Buffer) => {
				let value: string;
				try {
					value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
				} catch (cause) {
					fail(new AiProtocolInvalid(cause));
					return;
				}
				const waiter = pending;
				if (waiter) {
					pending = undefined;
					waiter(Effect.succeed(value));
				} else {
					queuedBytes += bytes.length;
					if (queue.length >= 64 || queuedBytes > LIMIT) {
						fail(new AiProtocolInvalid());
						return;
					}
					queue.push(value);
				}
			};
			const onData = (data: Buffer) => {
				if (failure) return;
				buffer = Buffer.concat([buffer, data]);
				if (buffer.length > LIMIT + 14) {
					fail(new AiProtocolInvalid());
					return;
				}
				while (buffer.length >= 2 && !failure) {
					const first = buffer[0] ?? 0;
					const second = buffer[1] ?? 0;
					const opcode = first & 15;
					const final = (first & 128) !== 0;
					let size = second & 127;
					let offset = 2;
					if (first & 112 || second & 128) {
						fail(new AiProtocolInvalid());
						return;
					}
					if (size === 126) {
						if (buffer.length < 4) return;
						size = buffer.readUInt16BE(2);
						offset = 4;
					} else if (size === 127) {
						if (buffer.length < 10) return;
						const big = buffer.readBigUInt64BE(2);
						if (big > BigInt(LIMIT)) {
							fail(new AiProtocolInvalid());
							return;
						}
						size = Number(big);
						offset = 10;
					}
					if (size > LIMIT || (opcode >= 8 && (!final || size > 125))) {
						fail(new AiProtocolInvalid());
						return;
					}
					if (buffer.length < offset + size) return;
					const payload = buffer.subarray(offset, offset + size);
					buffer = buffer.subarray(offset + size);
					if (opcode === 8) {
						fail(new AiUnavailable(), true);
						return;
					}
					if (opcode === 9) {
						socket.write(clientFrame(10, payload));
						continue;
					}
					if (opcode === 10) continue;
					if (
						(opcode !== 1 && opcode !== 0) ||
						(opcode === 0) !== fragmented.length > 0
					) {
						fail(new AiProtocolInvalid());
						return;
					}
					fragmented.push(payload);
					fragmentBytes += payload.length;
					if (fragmentBytes > LIMIT) {
						fail(new AiProtocolInvalid());
						return;
					}
					if (final) {
						message(Buffer.concat(fragmented));
						fragmented = [];
						fragmentBytes = 0;
					}
				}
			};
			socket.on("data", onData);
			socket.on("error", (cause) => fail(new AiUnavailable(cause)));
			socket.on("close", () => fail(new AiUnavailable(), true));
			opened = true;
			resume(
				Effect.succeed({
					send: (data) =>
						Effect.async<void, AiError>((done) => {
							if (failure) {
								done(Effect.fail(failure));
								return;
							}
							const bytes = typeof data === "string" ? Buffer.from(data) : data;
							if (
								bytes.length > 65535 ||
								socket.writableLength + bytes.length > 240000
							) {
								fail(new AiProtocolInvalid());
								done(Effect.fail(failure ?? new AiProtocolInvalid()));
								return;
							}
							socket.write(
								clientFrame(typeof data === "string" ? 1 : 2, bytes),
								(error) =>
									done(
										error ? Effect.fail(new AiUnavailable(error)) : Effect.void,
									),
							);
							return Effect.sync(close);
						}),
					receive: Effect.async((done) => {
						const next = queue.shift();
						if (next !== undefined) {
							queuedBytes -= Buffer.byteLength(next);
							done(Effect.succeed(next));
							return;
						}
						if (failure) {
							done(Effect.fail(failure));
							return;
						}
						if (pending) {
							done(Effect.fail(new AiProtocolInvalid()));
							return;
						}
						pending = done;
						return Effect.sync(() => {
							if (pending === done) pending = undefined;
						});
					}),
					close: Effect.sync(() => fail(new AiUnavailable())),
				}),
			);
			if (head.length) onData(head);
		});
		request.end();
		return Effect.sync(close);
	});
}
export const desktopWebSocket: typeof SpeechWebSocket.Service = {
	connect: (input) => connectSpeechSocket(input),
};

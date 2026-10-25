import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { connectSpeechSocket } from "./websocket";

const frame = (text: string, first = 0x81) =>
	Buffer.concat([
		Buffer.from([first, Buffer.byteLength(text)]),
		Buffer.from(text),
	]);
async function fixture(
	onSocket: (socket: Duplex, auth: string | undefined) => void,
) {
	const server = createServer();
	const sockets = new Set<Duplex>();
	server.on("upgrade", (request, socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		const accept = createHash("sha1")
			.update(
				`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
			)
			.digest("base64");
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
		);
		onSocket(socket, request.headers.authorization);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/inference`,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		},
	};
}
describe("authenticated desktop WebSocket using loopback only", () => {
	it("sends the auth header, masks client frames, joins fragmented server JSON and answers ping", async () => {
		let auth: string | undefined;
		const outbound: Buffer[] = [];
		let receive: (() => void) | undefined;
		const received = new Promise<void>((resolve) => {
			receive = resolve;
		});
		const server = await fixture((socket, header) => {
			auth = header;
			socket.on("data", (data) => {
				outbound.push(Buffer.from(data));
				if (Buffer.concat(outbound).length >= 17) receive?.();
			});
			socket.write(
				Buffer.concat([
					frame('{"header":', 0x01),
					frame('"ready"}', 0x80),
					Buffer.from([0x89, 1, 7]),
				]),
			);
		});
		const controller = new AbortController();
		try {
			const socket = await Effect.runPromise(
				connectSpeechSocket(
					{
						url: server.url,
						headers: { Authorization: "Bearer synthetic" },
						signal: controller.signal,
					},
					true,
				),
			);
			expect(await Effect.runPromise(socket.receive)).toBe(
				'{"header":"ready"}',
			);
			await Effect.runPromise(socket.send(new Uint8Array([1, 2, 3, 4])));
			await received;
			expect(auth).toBe("Bearer synthetic");
			const bytes = Buffer.concat(outbound);
			let offset = 0;
			const payloads: Buffer[] = [];
			while (offset < bytes.length) {
				const size = (bytes[offset + 1] ?? 0) & 127;
				expect((bytes[offset + 1] ?? 0) & 128).toBe(128);
				const mask = bytes.subarray(offset + 2, offset + 6);
				const payload = Buffer.from(
					bytes.subarray(offset + 6, offset + 6 + size),
				);
				for (let index = 0; index < payload.length; index++)
					payload[index] = (payload[index] ?? 0) ^ (mask[index % 4] ?? 0);
				payloads.push(payload);
				offset += 6 + size;
			}
			expect(payloads).toContainEqual(Buffer.from([7]));
			expect(payloads).toContainEqual(Buffer.from([1, 2, 3, 4]));
			await Effect.runPromise(socket.close);
		} finally {
			controller.abort();
			await server.close();
		}
	});
	it("physical abort fails a pending receive and destroys the connection", async () => {
		const server = await fixture(() => {});
		const controller = new AbortController();
		try {
			const socket = await Effect.runPromise(
				connectSpeechSocket(
					{ url: server.url, headers: {}, signal: controller.signal },
					true,
				),
			);
			const pending = Effect.runPromise(socket.receive.pipe(Effect.either));
			controller.abort();
			expect(Either.isLeft(await pending)).toBe(true);
		} finally {
			await server.close();
		}
	});
	it("rejects cleartext network routes outside the explicit loopback fixture mode", async () => {
		const result = await Effect.runPromise(
			connectSpeechSocket({
				url: "ws://127.0.0.1:1",
				headers: {},
				signal: new AbortController().signal,
			}).pipe(Effect.either),
		);
		expect(result).toMatchObject({
			_tag: "Left",
			left: { code: "AI.PROVIDER.UNAVAILABLE" },
		});
	});
	it("rejects masked server frames as protocol violations", async () => {
		const server = await fixture((socket) =>
			socket.write(Buffer.from([0x81, 0x80, 0, 0, 0, 0])),
		);
		const controller = new AbortController();
		try {
			const socket = await Effect.runPromise(
				connectSpeechSocket(
					{ url: server.url, headers: {}, signal: controller.signal },
					true,
				),
			);
			const result = await Effect.runPromise(
				socket.receive.pipe(Effect.either),
			);
			expect(result).toMatchObject({
				_tag: "Left",
				left: { code: "AI.PROVIDER.PROTOCOL_INVALID" },
			});
		} finally {
			controller.abort();
			await server.close();
		}
	});
});

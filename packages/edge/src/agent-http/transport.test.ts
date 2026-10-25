import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Chunk, Effect, Either, Fiber, Redacted, Stream } from "effect";
import type { RuntimeConnection } from "./runtime-contracts.js";
import type { RuntimeError } from "./runtime-errors.js";
import type {
	RuntimeHttpRequest,
	RuntimeHttpResponse,
} from "./runtime-ports.js";
import { makeRuntimeHttpTransport, parseSse, readJson } from "./transport.js";
import { fixture as createFixture } from "./transport-fixtures.js";

const transport = makeRuntimeHttpTransport();
const connection = (baseURL: string): RuntimeConnection => ({
	id: "fixture",
	name: "Fixture",
	kind: "hermes",
	baseURL,
});
const request = (
	baseURL: string,
	options: Partial<RuntimeHttpRequest> = {},
): RuntimeHttpRequest => ({
	connection: connection(baseURL),
	path: "/v1/chat/completions",
	method: "GET",
	...options,
});
const releases: Array<() => Promise<void>> = [];
async function fixture(handler: Parameters<typeof createFixture>[0]) {
	const server = await createFixture(handler);
	releases.push(server.close);
	return server;
}
afterEach(async () => {
	for (const release of releases.splice(0)) await release();
});
const latch = () => {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve: () => resolve() };
};
async function failure<A>(
	effect: Effect.Effect<A, RuntimeError>,
): Promise<RuntimeError> {
	const result = await Effect.runPromise(Effect.either(effect));
	expect(Either.isLeft(result)).toBe(true);
	if (Either.isRight(result)) throw new Error("Expected a typed failure");
	return result.left;
}
function bytesResponse(
	bytes: Uint8Array[],
	contentType = "text/event-stream",
): RuntimeHttpResponse {
	return {
		status: 200,
		headers: { "content-type": contentType },
		body: Stream.fromIterable(bytes),
	};
}
const encoded = (text: string) => new TextEncoder().encode(text);

describe("authenticated HTTP transport", () => {
	it("preserves gateway subpaths, bearer and provider headers, JSON body and HTTPS URLs", async () => {
		let received: unknown;
		const server = await fixture(async (req, res) => {
			let body = "";
			for await (const chunk of req) body += chunk.toString();
			received = {
				url: req.url,
				method: req.method,
				auth: req.headers.authorization,
				session: req.headers["x-session"],
				body: JSON.parse(body),
			};
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end('{"ok":true}');
		});
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const response = yield* transport.execute(
						request(`${server.baseURL}/gateway/`, {
							method: "POST",
							credential: Redacted.make("fixture-secret"),
							headers: { "X-Session": "session-1" },
							body: { messages: ["hello"] },
						}),
					);
					return yield* readJson(response);
				}),
			),
		);
		expect(result).toEqual({ ok: true });
		expect(received).toEqual({
			url: "/gateway/v1/chat/completions",
			method: "POST",
			auth: "Bearer fixture-secret",
			session: "session-1",
			body: { messages: ["hello"] },
		});
		let secureURL: unknown;
		const https = makeRuntimeHttpTransport(async (url, init) => {
			secureURL = url;
			expect(init?.redirect).toBe("error");
			return new Response("{}", {
				headers: { "content-type": "application/json" },
			});
		});
		await Effect.runPromise(
			Effect.scoped(
				https.execute(request("https://runtime.example.ts.net/base")),
			),
		);
		expect(secureURL).toBe(
			"https://runtime.example.ts.net/base/v1/chat/completions",
		);
	});
	it.each([
		"file:///etc/passwd",
		"ftp://localhost",
		"http://name:secret@localhost",
		"http://localhost/#secret",
		"http://localhost/?token=secret",
		"http://localhost/../escape",
		"http://localhost/%252e%252e/",
	])("rejects unsafe base URL before dispatch: %s", async (baseURL) => {
		let calls = 0;
		const http = makeRuntimeHttpTransport(async () => {
			calls++;
			return new Response("{}");
		});
		const error = await failure(Effect.scoped(http.execute(request(baseURL))));
		expect(error._tag).toBe("RuntimeConnectionInvalid");
		expect(calls).toBe(0);
		expect(JSON.stringify(error)).not.toContain("secret");
	});
	it.each([
		"https://evil.example/",
		"//evil.example/",
		"../escape",
		"/%2e%2e/escape",
		"/%2f%2fevil.example",
		"/v1\\evil",
		"/v1#fragment",
	])("rejects an escaping request path before dispatch: %s", async (path) => {
		let calls = 0;
		const http = makeRuntimeHttpTransport(async () => {
			calls++;
			return new Response("{}");
		});
		expect(
			(
				await failure(
					Effect.scoped(
						http.execute(request("http://localhost/base", { path })),
					),
				)
			)._tag,
		).toBe("RuntimeConnectionInvalid");
		expect(calls).toBe(0);
	});
	it.each([
		{ headers: { Authorization: "Bearer hidden" } },
		{ headers: { Host: "evil.example" } },
		{ headers: { "X-Session": "bad\r\nAuthorization: hidden" } },
		{ credential: Redacted.make("bad\r\nsecret") },
		{ timeoutMs: 0 },
		{ maxResponseBytes: Infinity },
		{ maxEventBytes: -1 },
	])(
		"rejects malformed limits, credential or header input before dispatch",
		async (options) => {
			let calls = 0;
			const http = makeRuntimeHttpTransport(async () => {
				calls++;
				return new Response("{}");
			});
			expect(
				(
					await failure(
						Effect.scoped(http.execute(request("http://localhost", options))),
					)
				)._tag,
			).toBe("RuntimeConnectionInvalid");
			expect(calls).toBe(0);
		},
	);
	it("rejects redirects without sending the bearer to a second server", async () => {
		let hits = 0;
		const target = await fixture((_req, res) => {
			hits++;
			res.end("{}");
		});
		const server = await fixture((_req, res) => {
			res.writeHead(307, { Location: target.baseURL });
			res.end();
		});
		const error = await failure(
			Effect.scoped(
				transport.execute(
					request(server.baseURL, {
						credential: Redacted.make("fixture-secret"),
					}),
				),
			),
		);
		expect(error._tag).toBe("RuntimeUnavailable");
		expect(hits).toBe(0);
		expect(JSON.stringify(error)).not.toContain("fixture-secret");
	});
	it("also rejects an injected fetch implementation that returns a redirect", async () => {
		let cancelled = false;
		const http = makeRuntimeHttpTransport(
			async () =>
				new Response(
					new ReadableStream({
						cancel: () => {
							cancelled = true;
						},
					}),
					{ status: 302, headers: { location: "http://evil.example" } },
				),
		);
		expect(
			(await failure(Effect.scoped(http.execute(request("http://localhost")))))
				._tag,
		).toBe("RuntimeProtocolInvalid");
		expect(cancelled).toBe(true);
	});
	it("returns safe discovery statuses and bounds an error body without exposing it", async () => {
		const server = await fixture((_req, res) => {
			res.writeHead(405, { "Content-Type": "text/plain" });
			res.end("private-token-response-body");
		});
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const response = yield* transport.execute(
						request(server.baseURL, { maxErrorBytes: 4 }),
					);
					expect(response.status).toBe(405);
					return yield* Effect.either(Stream.runCollect(response.body));
				}),
			),
		);
		expect(Either.isLeft(result) && result.left._tag).toBe(
			"RuntimeLimitExceeded",
		);
		expect(JSON.stringify(result)).not.toContain("private-token");
	});
	it.each([401, 403, 429, 500])(
		"JSON helpers fail HTTP %i through safe catalog errors",
		async (status) => {
			const server = await fixture((_req, res) => {
				res.writeHead(status, { "Content-Type": "application/json" });
				res.end('{"token":"private-response-secret"}');
			});
			const error = await failure(
				Effect.scoped(
					Effect.gen(function* () {
						return yield* readJson(
							yield* transport.execute(request(server.baseURL)),
						);
					}),
				),
			);
			expect(error._tag).toBe(
				status === 401 || status === 403
					? "RuntimeAuthenticationFailed"
					: "RuntimeRequestFailed",
			);
			expect(JSON.stringify(error)).not.toContain("private-response-secret");
		},
	);
	it("doesn't retry after a POST disconnect and retains private failure identity", async () => {
		let calls = 0;
		const server = await fixture((req) => {
			calls++;
			req.socket.destroy();
		});
		const error = await failure(
			Effect.scoped(
				transport.execute(
					request(server.baseURL, { method: "POST", body: { input: "hello" } }),
				),
			),
		);
		expect(calls).toBe(1);
		expect(error._tag).toBe("RuntimeUnavailable");
		expect(error.originalCause).toBeInstanceOf(Error);
		expect(Object.keys(error)).not.toContain("originalCause");
		const cause = new TypeError(
			"Bearer private-secret at http://private-host",
			{ cause: new Error("token=private-secret") },
		);
		const http = makeRuntimeHttpTransport(async () => {
			throw cause;
		});
		const privateError = await failure(
			Effect.scoped(http.execute(request("http://localhost"))),
		);
		expect(privateError.originalCause).toBe(cause);
		expect(JSON.stringify(privateError)).not.toMatch(
			/private-secret|private-host|Bearer/,
		);
	});
	it("caller abort physically closes a blocked body read", async () => {
		const opened = latch(),
			closed = latch();
		const server = await fixture((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.write(": ready\n\n");
			res.on("close", closed.resolve);
			opened.resolve();
		});
		const controller = new AbortController();
		const result = Effect.runPromise(
			Effect.either(
				Effect.scoped(
					Effect.gen(function* () {
						return yield* parseSse(
							yield* transport.execute(
								request(server.baseURL, { signal: controller.signal }),
							),
						).pipe(Stream.runCollect);
					}),
				),
			),
		);
		await opened.promise;
		controller.abort();
		const output = await result;
		await closed.promise;
		expect(Either.isLeft(output) && output.left._tag).toBe(
			"RuntimeRequestFailed",
		);
	});
	it("fiber interruption aborts a blocked read and never delivers late data", async () => {
		const opened = latch(),
			closed = latch();
		let delivered = 0;
		const server = await fixture((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.write(": ready\n\n");
			res.on("close", closed.resolve);
			opened.resolve();
		});
		const stream = Stream.unwrapScoped(
			Effect.map(transport.execute(request(server.baseURL)), parseSse),
		);
		const fiber = Effect.runFork(
			stream.pipe(
				Stream.tap(() =>
					Effect.sync(() => {
						delivered++;
					}),
				),
				Stream.runDrain,
			),
		);
		await opened.promise;
		await Effect.runPromise(Fiber.interrupt(fiber));
		await closed.promise;
		expect(delivered).toBe(0);
	});
	it("scope exit aborts an unconsumed HTTP response", async () => {
		const closed = latch();
		const server = await fixture((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.write(": ready\n\n");
			res.on("close", closed.resolve);
		});
		await Effect.runPromise(
			Effect.scoped(transport.execute(request(server.baseURL))),
		);
		await closed.promise;
	});
	it.each([false, true])(
		"deadline aborts network while waiting for headers or body, headersSent=%s",
		async (headersSent) => {
			const closed = latch();
			const server = await fixture((req, res) => {
				req.socket.on("close", closed.resolve);
				if (headersSent) {
					res.writeHead(200, { "Content-Type": "text/event-stream" });
					res.write(": ready\n\n");
				}
			});
			const error = await failure(
				Effect.scoped(
					Effect.gen(function* () {
						const response = yield* transport.execute(
							request(server.baseURL, { timeoutMs: 100 }),
						);
						return yield* Stream.runCollect(response.body);
					}),
				),
			);
			expect(error._tag).toBe("RuntimeTimeout");
			await closed.promise;
		},
	);
	it("an already aborted signal never reaches the server", async () => {
		let calls = 0;
		const server = await fixture((_req, res) => {
			calls++;
			res.end("{}");
		});
		const controller = new AbortController();
		controller.abort();
		expect(
			(
				await failure(
					Effect.scoped(
						transport.execute(
							request(server.baseURL, { signal: controller.signal }),
						),
					),
				)
			)._tag,
		).toBe("RuntimeRequestFailed");
		expect(calls).toBe(0);
	});
	it("body limits and early stream stop physically disconnect the HTTP response", async () => {
		for (const limit of [false, true]) {
			const closed = latch();
			const server = await fixture((_req, res) => {
				res.writeHead(200, { "Content-Type": "text/event-stream" });
				res.write("data: first\n\n");
				res.on("close", closed.resolve);
			});
			const result = await Effect.runPromise(
				Effect.either(
					Effect.scoped(
						Effect.gen(function* () {
							const response = yield* transport.execute(
								request(server.baseURL, { maxResponseBytes: limit ? 3 : 1024 }),
							);
							return yield* parseSse(response).pipe(
								Stream.take(1),
								Stream.runCollect,
							);
						}),
					),
				),
			);
			await closed.promise;
			expect(
				Either.isLeft(result)
					? result.left._tag
					: Chunk.toReadonlyArray(result.right),
			).toEqual(
				limit ? "RuntimeLimitExceeded" : [{ event: "message", data: "first" }],
			);
		}
	});
});

describe("bounded JSON and SSE decoding", () => {
	it("decodes JSON from fragmented UTF-8 and accepts structured JSON content types", async () => {
		const bytes = encoded('{"text":"héllo 😃"}');
		const result = await Effect.runPromise(
			readJson(
				bytesResponse(
					Array.from(bytes, (byte) => Uint8Array.of(byte)),
					"application/problem+json; charset=UTF-8",
				),
			),
		);
		expect(result).toEqual({ text: "héllo 😃" });
	});
	it.each(["text/html", "text/event-stream", ""])(
		"rejects non-JSON content type %s",
		async (type) => {
			expect(
				(await failure(readJson(bytesResponse([encoded("{}")], type))))._tag,
			).toBe("RuntimeProtocolInvalid");
		},
	);
	it("rejects malformed JSON, invalid or truncated UTF-8 and oversized successful bodies", async () => {
		for (const bytes of [
			encoded('{"private":"secret"'),
			Uint8Array.of(0xc0, 0xaf),
			Uint8Array.of(0xe2, 0x82),
		]) {
			const error = await failure(
				readJson(bytesResponse([bytes], "application/json")),
			);
			expect(error._tag).toBe("RuntimeProtocolInvalid");
			expect(JSON.stringify(error)).not.toContain("secret");
		}
		expect(
			(
				await failure(
					readJson(
						bytesResponse([encoded('{"hello":true}')], "application/json"),
						{ maxResponseBytes: 4 },
					),
				)
			)._tag,
		).toBe("RuntimeLimitExceeded");
	});
	it("preserves named events, multiline data and IDs at every UTF-8/CRLF partition", async () => {
		const bytes = encoded(
			"\ufeff: heartbeat\r\nevent: hermes.status\r\nid: session-1\r\ndata: héllo 😃\r\ndata: world\r\n\r\nevent: hermes.tool.progress\rdata: working\r\rdata:\n\n",
		);
		for (let size = 1; size <= bytes.length; size++) {
			const chunks = [];
			for (let offset = 0; offset < bytes.length; offset += size)
				chunks.push(bytes.slice(offset, offset + size));
			const result = await Effect.runPromise(
				parseSse(bytesResponse(chunks)).pipe(Stream.runCollect),
			);
			expect(Chunk.toReadonlyArray(result)).toEqual([
				{ event: "hermes.status", id: "session-1", data: "héllo 😃\nworld" },
				{ event: "hermes.tool.progress", id: "session-1", data: "working" },
				{ event: "message", id: "session-1", data: "" },
			]);
		}
	});
	it("frames a real HTTP SSE response streamed one byte at a time", async () => {
		const server = await fixture(async (_req, res) => {
			res.writeHead(200, {
				"Content-Type": "text/event-stream; charset=utf-8",
			});
			for (const byte of encoded(
				"event: hermes.status\r\ndata: héllo\r\n\r\n",
			)) {
				res.write(Uint8Array.of(byte));
				await setImmediate();
			}
			res.end();
		});
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					return yield* parseSse(
						yield* transport.execute(request(server.baseURL)),
					).pipe(Stream.runCollect);
				}),
			),
		);
		expect(Chunk.toReadonlyArray(result)).toEqual([
			{ event: "hermes.status", data: "héllo" },
		]);
	});
	it("discards incomplete trailing events and ignores NUL IDs and unknown fields", async () => {
		const result = await Effect.runPromise(
			parseSse(
				bytesResponse([
					encoded(
						"id: good\nignored: field\nid: bad\0id\ndata: first\n\ndata: unfinished",
					),
				]),
			).pipe(Stream.runCollect),
		);
		expect(Chunk.toReadonlyArray(result)).toEqual([
			{ event: "message", data: "first", id: "good" },
		]);
	});
	it.each([
		encoded(`data: ${"x".repeat(100)}`),
		encoded("data: aa\ndata: bb\n\n"),
		encoded(`: ${"x".repeat(100)}\n`),
		encoded(`event: ${"x".repeat(100)}\n`),
	])(
		"bounds unterminated lines, whole events, comments and metadata",
		async (bytes) => {
			const error = await failure(
				parseSse(bytesResponse([bytes]), { maxEventBytes: 10 }).pipe(
					Stream.runCollect,
				),
			);
			expect(error._tag).toBe("RuntimeLimitExceeded");
		},
	);
	it("uses request-level event limits and rejects non-SSE or invalid UTF-8 responses", async () => {
		const server = await fixture((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			res.end("data: private-large-value\n\n");
		});
		const error = await failure(
			Effect.scoped(
				Effect.gen(function* () {
					return yield* parseSse(
						yield* transport.execute(
							request(server.baseURL, { maxEventBytes: 8 }),
						),
					).pipe(Stream.runCollect);
				}),
			),
		);
		expect(error._tag).toBe("RuntimeLimitExceeded");
		expect(JSON.stringify(error)).not.toContain("private-large-value");
		for (const response of [
			bytesResponse([encoded("data: hello\n\n")], "application/json"),
			bytesResponse([Uint8Array.of(0xff)]),
			bytesResponse([Uint8Array.of(0xe2, 0x82)]),
		]) {
			expect(
				(await failure(parseSse(response).pipe(Stream.runCollect)))._tag,
			).toBe("RuntimeProtocolInvalid");
		}
	});
});

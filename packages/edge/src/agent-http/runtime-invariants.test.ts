import { Either, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	RuntimeConnection,
	RuntimeConnectionView,
	RuntimeConversationEvent,
	RuntimeConversationRequest,
	RuntimeKind,
} from "./runtime-contracts.js";
import {
	RuntimeAuthenticationFailed,
	RuntimeCapabilityUnsupported,
	RuntimeConnectionInvalid,
	RuntimeCredentialUnavailable,
	RuntimeLimitExceeded,
	RuntimeProtocolInvalid,
	RuntimeRequestFailed,
	RuntimeStorageFailed,
	RuntimeTimeout,
	RuntimeUnavailable,
} from "./runtime-errors.js";
import {
	isRuntimeBaseURL,
	normalizeRuntimeBaseURL,
	resolveRuntimeURL,
} from "./runtime-invariants.js";

const connection = {
	id: "local-hermes",
	name: "Hermes on this device",
	kind: "hermes",
	baseURL: "http://localhost:8642/agent-gateway",
} as const;

describe("runtime endpoint policy", () => {
	it.each([
		["http://localhost:8642", "http://localhost:8642/"],
		["http://127.0.0.1:8642/", "http://127.0.0.1:8642/"],
		["http://[::1]:8642/gateway", "http://[::1]:8642/gateway/"],
		["http://192.168.1.44:8080/agent", "http://192.168.1.44:8080/agent/"],
		["http://100.90.80.70:8080/agent", "http://100.90.80.70:8080/agent/"],
		[
			"https://hermes.xalda-procyon.ts.net/agent",
			"https://hermes.xalda-procyon.ts.net/agent/",
		],
	])("accepts an explicit HTTP endpoint %s", (input, normalized) => {
		expect(normalizeRuntimeBaseURL(input)).toBe(normalized);
		expect(isRuntimeBaseURL(input)).toBe(true);
	});

	it.each([
		"",
		"localhost:8642",
		"https:///localhost/api",
		"http:////localhost/api",
		"ws://localhost:8642",
		"file:///etc/passwd",
		"https://token@localhost/",
		"https://user:password@localhost/",
		"https://localhost/?api_key=secret",
		"https://localhost/#secret",
		"https://localhost/?",
		"https://localhost/#",
		" https://localhost/",
		"https://localhost/\n",
		"https:\\localhost\\agent",
		"https://localhost/a/../b",
		"https://localhost/a/%2e%2e/b",
		"https://localhost/a/%252e%252e/b",
		"https://localhost/a/%2f/b",
		"https://localhost/a/%5c/b",
		"https://localhost/a/%00/b",
		"https://localhost/a/%7f/b",
		"https://localhost/%zz",
		"https://localhost/a/./b",
		"https://localhost/a/%2e/b",
		"https://localhost/a b",
	])("rejects unsafe base URL %s", (input) => {
		expect(normalizeRuntimeBaseURL(input)).toBeUndefined();
		expect(isRuntimeBaseURL(input)).toBe(false);
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(RuntimeConnection)({
					...connection,
					baseURL: input,
				}),
			),
		).toBe(true);
	});

	it("retains gateway subpaths with relative and leading slash adapter paths", () => {
		for (const path of ["v1/models", "/v1/models"]) {
			expect(resolveRuntimeURL(connection.baseURL, path)).toBe(
				"http://localhost:8642/agent-gateway/v1/models",
			);
		}
		expect(
			resolveRuntimeURL(connection.baseURL, "v1/sessions?limit=10&cursor=next"),
		).toBe(
			"http://localhost:8642/agent-gateway/v1/sessions?limit=10&cursor=next",
		);
	});

	it.each([
		"https://other.ts.net/v1/models",
		"//other.ts.net/v1/models",
		"///other.ts.net/v1/models",
		"../v1/models",
		"/../v1/models",
		"a/../../v1/models",
		"%2e%2e/v1/models",
		"%252e%252e/v1/models",
		"a%2fb/models",
		"a%5cb/models",
		"v1/./models",
		"v1/models#secret",
		"v1\\models",
		"v1/%zz",
		"v1/%00",
		"v1/models\n",
	])("rejects path escape or origin override %s", (path) => {
		expect(resolveRuntimeURL(connection.baseURL, path)).toBeUndefined();
	});

	it("never resolves an arbitrary accepted path outside the configured base", () => {
		fc.assert(
			fc.property(fc.string(), (path) => {
				const result = resolveRuntimeURL(connection.baseURL, path);
				if (result === undefined) return;
				const parsed = new URL(result);
				expect(parsed.origin).toBe("http://localhost:8642");
				expect(parsed.pathname.startsWith("/agent-gateway/")).toBe(true);
				expect(parsed.username).toBe("");
				expect(parsed.password).toBe("");
			}),
			{ numRuns: 300 },
		);
	});

	it("normalizes generated local gateway URLs idempotently without dropping their path", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(
					"http://localhost:8642",
					"https://hermes.xalda-procyon.ts.net",
					"http://192.168.1.2:8080",
				),
				fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,24}$/), {
					minLength: 1,
					maxLength: 5,
				}),
				(origin, segments) => {
					const input = `${origin}/${segments.join("/")}`;
					const normalized = normalizeRuntimeBaseURL(input);
					expect(normalized).toBe(`${input}/`);
					expect(normalizeRuntimeBaseURL(normalized ?? "")).toBe(normalized);
					expect(resolveRuntimeURL(input, "/v1/chat/completions")).toBe(
						`${input}/v1/chat/completions`,
					);
				},
			),
			{ numRuns: 300 },
		);
	});
});

describe("runtime wire contracts", () => {
	it("limits runtime kinds to the two implemented adapters", () => {
		for (const kind of ["openclaw", "hermes"])
			expect(Schema.decodeUnknownSync(RuntimeKind)(kind)).toBe(kind);
		expect(Either.isLeft(Schema.decodeUnknownEither(RuntimeKind)("mock"))).toBe(
			true,
		);
	});

	it("projects connection metadata without credential references or secret extras", () => {
		const output = Schema.decodeUnknownSync(RuntimeConnectionView)({
			...connection,
			credentialAvailable: true,
			credentialRef: "private-reference",
			secret: "private-token",
		});
		expect(output).toEqual({ ...connection, credentialAvailable: true });
		expect(JSON.stringify(output)).not.toContain("private");
	});

	it("requires bounded messages and conversation ownership identifiers", () => {
		const request = {
			connectionId: connection.id,
			conversationId: "chat-1",
			modelId: "hermes",
			sessionId: "backend-session",
			messages: [{ role: "user", content: "hello" }],
		};
		expect(
			Schema.decodeUnknownSync(RuntimeConversationRequest)(request),
		).toEqual(request);
		for (const input of [
			{ ...request, conversationId: "" },
			{ ...request, connectionId: "" },
			{ ...request, messages: [] },
			{
				...request,
				messages: Array.from({ length: 257 }, () => request.messages[0]),
			},
			{ ...request, messages: [{ role: "user", content: "x".repeat(262145) }] },
		])
			expect(
				Either.isLeft(
					Schema.decodeUnknownEither(RuntimeConversationRequest)(input),
				),
			).toBe(true);
	});

	it("distinguishes client function requests from observed execution progress", () => {
		for (const phase of ["requested", "running", "completed", "failed"]) {
			const event = {
				_tag: "tool",
				toolCallId: "call-1",
				tool: "read_file",
				phase,
			};
			expect(Schema.decodeUnknownSync(RuntimeConversationEvent)(event)).toEqual(
				event,
			);
		}
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(RuntimeConversationEvent)({
					_tag: "tool",
					toolCallId: "call-1",
					tool: "read_file",
					phase: "invented",
				}),
			),
		).toBe(true);
	});

	it("carries backend session continuity and reported AI usage", () => {
		for (const event of [
			{ _tag: "completed", sessionId: "session-2" },
			{
				_tag: "status",
				kind: "thinking",
				text: "Working",
				sessionId: "session-2",
			},
			{
				_tag: "usage",
				usage: { inputTokens: 4, outputTokens: 7, provenance: "reported" },
			},
		])
			expect(Schema.decodeUnknownSync(RuntimeConversationEvent)(event)).toEqual(
				event,
			);
	});
});

describe("runtime catalog diagnostics", () => {
	it.each([
		[RuntimeConnectionInvalid, "CONNECTION.INVALID"],
		[RuntimeAuthenticationFailed, "AUTH.FAILED"],
		[RuntimeUnavailable, "CONNECTION.UNAVAILABLE"],
		[RuntimeProtocolInvalid, "PROTOCOL.INVALID"],
		[RuntimeCapabilityUnsupported, "CAPABILITY.UNSUPPORTED"],
		[RuntimeRequestFailed, "REQUEST.FAILED"],
		[RuntimeTimeout, "REQUEST.TIMEOUT"],
		[RuntimeLimitExceeded, "RESPONSE.LIMIT_EXCEEDED"],
		[RuntimeCredentialUnavailable, "CREDENTIAL.UNAVAILABLE"],
		[RuntimeStorageFailed, "STORAGE.FAILED"],
	] as const)(
		"retains original cause privately for %s",
		(ErrorType, suffix) => {
			const cause = new TypeError(
				"Bearer private-token at https://private-host/secret",
				{ cause: new Error("private-prompt") },
			);
			const failure = new ErrorType(cause);
			expect(failure._tag).toBe(ErrorType.name);
			expect(failure.code).toBe(`AGENT.HTTP.${suffix}`);
			expect(failure.originalCause).toBe(cause);
			expect(Object.keys(failure)).not.toContain("originalCause");
			expect(failure.diagnosticCause).toEqual({
				name: "TypeError",
				truncated: true,
				cause: { name: "Error", truncated: true },
			});
			expect(JSON.stringify(failure)).not.toContain("private");
			expect(
				Schema.decodeUnknownSync(
					Schema.Union(
						RuntimeConnectionInvalid,
						RuntimeAuthenticationFailed,
						RuntimeUnavailable,
						RuntimeProtocolInvalid,
						RuntimeCapabilityUnsupported,
						RuntimeRequestFailed,
						RuntimeTimeout,
						RuntimeLimitExceeded,
						RuntimeCredentialUnavailable,
						RuntimeStorageFailed,
					),
				)(failure).code,
			).toBe(failure.code);
		},
	);
});

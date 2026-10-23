import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import {
	AiCredentialStoreFailed,
	AiRateLimited,
	toSafeDiagnosticCause,
} from "./ai-errors.js";

describe("AI diagnostic boundary", () => {
	it("omits upstream content and retains the original privately through Schema serialization", () => {
		fc.assert(
			fc.property(fc.uuid(), (privateText) => {
				const cause = Object.assign(
					new TypeError(privateText, { cause: new Error(privateText) }),
					{ name: privateText, code: privateText, requestBody: privateText },
				);
				const error = new AiRateLimited(cause);
				expect(error.code).toBe("AI.PROVIDER.RATE_LIMITED");
				expect(error.originalCause).toBe(cause);
				expect(JSON.stringify(error)).not.toContain(privateText);
				const encoded = Schema.encodeSync(AiRateLimited)(error);
				expect(JSON.stringify(encoded)).not.toContain(privateText);
				expect(encoded.diagnosticCause).toEqual({
					name: "TypeError",
					cause: { name: "Error", truncated: true },
					truncated: true,
				});
				expect(Schema.decodeUnknownSync(AiRateLimited)(encoded).code).toBe(
					error.code,
				);
			}),
		);
	});
	it("bounds circular causes and tolerates hostile getters", () => {
		const circular = new Error();
		circular.cause = circular;
		let safe = toSafeDiagnosticCause(circular);
		let depth = 0;
		while (safe.cause) {
			depth++;
			safe = safe.cause;
		}
		expect(depth).toBe(4);
		expect(safe.name).toBe("TruncatedCause");
		const hostile = new Error();
		Object.defineProperty(hostile, "code", {
			get: () => {
				throw new Error();
			},
		});
		expect(() => new AiCredentialStoreFailed(hostile)).not.toThrow();
		expect(toSafeDiagnosticCause(hostile)).toEqual({
			name: "UnknownCause",
			truncated: true,
		});
		expect(
			toSafeDiagnosticCause(Object.assign(new Error(), { code: "EACCES" })),
		).toEqual({ name: "Error", sourceCode: "EACCES", truncated: true });
	});
});

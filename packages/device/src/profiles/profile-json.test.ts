import { describe, expect, it } from "@effect/vitest";
import { Either, FastCheck as fc, Schema } from "effect";
import { ProfileJson, ProfileJsonObject } from "./profile-contracts.js";

const reservedKeys = ["__proto__", "constructor", "prototype"] as const;
const jsonWithReservedKeys = fc
	.jsonValue()
	.map((value) =>
		Object.fromEntries([
			...reservedKeys.map((key) => [key, value]),
			["nested", [Object.fromEntries(reservedKeys.map((key) => [key, value]))]],
		]),
	);

describe("profile JSON records", () => {
	it.each(reservedKeys)(
		"preserves the own %s key at every JSON boundary",
		(key) => {
			for (const value of [
				null,
				1,
				false,
				"legacy",
				[],
				{ originalId: "legacy" },
			]) {
				const input: unknown = JSON.parse(JSON.stringify({ [key]: value }));
				const check = <A>(schema: Schema.Schema<A>) => {
					const decoded = Schema.decodeUnknownSync(schema)(input);
					expect(
						decoded !== null &&
							typeof decoded === "object" &&
							Object.hasOwn(decoded, key),
					).toBe(true);
					const encoded = Schema.encodeSync(schema)(decoded);
					expect(JSON.stringify(encoded)).toBe(JSON.stringify(input));
					expect(
						JSON.stringify(Schema.decodeUnknownSync(schema)(encoded)),
					).toBe(JSON.stringify(input));
				};
				check(ProfileJson);
				check(ProfileJsonObject);
			}
		},
	);

	it.prop(
		"round trips arbitrary JSON including nested reserved keys without data loss",
		[fc.oneof(fc.jsonValue(), jsonWithReservedKeys)],
		([input]) => {
			const decoded = Schema.decodeUnknownSync(ProfileJson)(input);
			const encoded = Schema.encodeSync(ProfileJson)(decoded);
			expect(JSON.stringify(encoded)).toBe(JSON.stringify(input));
		},
	);
	it.prop(
		"round trips arbitrary JSON objects with reserved own keys",
		[jsonWithReservedKeys],
		([input]) => {
			const decoded = Schema.decodeUnknownSync(ProfileJsonObject)(input);
			const encoded = Schema.encodeSync(ProfileJsonObject)(decoded);
			expect(JSON.stringify(encoded)).toBe(JSON.stringify(input));
		},
	);
	it("detaches nested records and arrays and never inherits payload properties", () => {
		const nested = { originalId: "legacy" };
		const input = { ["__proto__"]: nested, children: [nested] };
		const decoded = Schema.decodeUnknownSync(ProfileJsonObject)(input);
		expect(Object.getPrototypeOf(decoded)).toBeNull();
		expect(decoded.originalId).toBeUndefined();
		expect(Object.values(decoded)).not.toContain(nested);
		expect(decoded.children).not.toBe(input.children);
		nested.originalId = "draft mutation";
		expect(JSON.stringify(decoded)).not.toContain("draft mutation");
		expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
	});
	it("rejects non-JSON values even inside reserved keys", () => {
		for (const value of [
			undefined,
			Infinity,
			NaN,
			() => 1,
			Symbol("invalid"),
		]) {
			for (const key of reservedKeys) {
				const input = { [key]: value };
				expect(
					Either.isLeft(Schema.decodeUnknownEither(ProfileJson)(input)),
				).toBe(true);
				expect(
					Either.isLeft(Schema.decodeUnknownEither(ProfileJsonObject)(input)),
				).toBe(true);
			}
		}
	});
});

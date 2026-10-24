import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeAccountConfig, encodeAccountConfig } from "./account-config";

describe("electron-store account file compatibility", () => {
	it("reads a conf-9 independently constructed IV-prefixed AES-CBC record", () => {
		const account = "old";
		const iv = Buffer.alloc(16, 0xab);
		const key = pbkdf2Sync(
			`${account}_${["DK", "Suite"].join("")}`,
			iv.toString(),
			10000,
			32,
			"sha512",
		);
		const cipher = createCipheriv("aes-256-cbc", key, iv);
		const value = {
			quakeConfig: {
				deviceMenuProfile: [{ resourceId: "one", title: "My profile" }],
			},
		};
		const record = Buffer.concat([
			iv,
			Buffer.from(":"),
			cipher.update(JSON.stringify(value)),
			cipher.final(),
		]);
		expect(decodeAccountConfig(record, account)).toEqual(value);
	});
	it("exports the conf-9 envelope, not plaintext JSON", () => {
		const value = { quakeConfig: { deviceMenuProfile: [] } };
		const bytes = Buffer.from(encodeAccountConfig(value, "default"));
		expect(bytes[16]).toBe(58);
		const key = pbkdf2Sync(
			`default_${["DK", "Suite"].join("")}`,
			bytes.subarray(0, 16).toString(),
			10000,
			32,
			"sha512",
		);
		const decipher = createDecipheriv(
			"aes-256-cbc",
			key,
			bytes.subarray(0, 16),
		);
		expect(
			JSON.parse(
				Buffer.concat([
					decipher.update(bytes.subarray(17)),
					decipher.final(),
				]).toString(),
			),
		).toEqual(value);
	});
	it("rejects malformed or wrong-account inner records", () => {
		const bytes = encodeAccountConfig({}, "old");
		expect(() => decodeAccountConfig(bytes, "other")).toThrow();
	});
});

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	pbkdf2Sync,
	randomBytes,
} from "node:crypto";
import { Schema } from "effect";
import { ProfileJsonObject } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { BackupInvalid } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";

/** electron-store 7 / conf 9 wire format. The key is an app-format identifier, not a user secret. */
const accountKey = (account: string): string =>
	`${account}_${["DK", "Suite"].join("")}`;
export function encodeAccountConfig(
	value: unknown,
	account: string,
): Uint8Array {
	const valid = Schema.decodeUnknownSync(ProfileJsonObject)(value);
	const iv = randomBytes(16);
	const key = pbkdf2Sync(
		accountKey(account),
		iv.toString(),
		10000,
		32,
		"sha512",
	);
	const cipher = createCipheriv("aes-256-cbc", key, iv);
	return Buffer.concat([
		iv,
		Buffer.from(":"),
		cipher.update(JSON.stringify(valid, null, "\t")),
		cipher.final(),
	]);
}
export function decodeAccountConfig(
	bytes: Uint8Array,
	account: string,
): typeof ProfileJsonObject.Type {
	const data = Buffer.from(bytes);
	try {
		if (data[16] === 0x3a) {
			const iv = data.subarray(0, 16);
			const key = pbkdf2Sync(
				accountKey(account),
				iv.toString(),
				10000,
				32,
				"sha512",
			);
			const decipher = createDecipheriv("aes-256-cbc", key, iv);
			return Schema.decodeUnknownSync(ProfileJsonObject)(
				JSON.parse(
					Buffer.concat([
						decipher.update(data.subarray(17)),
						decipher.final(),
					]).toString("utf8"),
				),
			);
		}
		// Conf also accepts unencrypted JSON, for stores created before encryption was enabled.
		if (data.toString("utf8").trimStart().startsWith("{"))
			return Schema.decodeUnknownSync(ProfileJsonObject)(
				JSON.parse(data.toString("utf8")),
			);
		// Historical createCipher/createDecipher uses OpenSSL EVP_BytesToKey(MD5), no salt.
		const chunks: Buffer[] = [];
		let previous = Buffer.alloc(0);
		let length = 0;
		while (length < 48) {
			previous = createHash("md5")
				.update(Buffer.concat([previous, Buffer.from(accountKey(account))]))
				.digest();
			chunks.push(previous);
			length += previous.length;
		}
		const derived = Buffer.concat(chunks);
		const decipher = createDecipheriv(
			"aes-256-cbc",
			derived.subarray(0, 32),
			derived.subarray(32, 48),
		);
		return Schema.decodeUnknownSync(ProfileJsonObject)(
			JSON.parse(
				Buffer.concat([decipher.update(data), decipher.final()]).toString(
					"utf8",
				),
			),
		);
	} catch (cause) {
		throw new BackupInvalid(cause);
	}
}

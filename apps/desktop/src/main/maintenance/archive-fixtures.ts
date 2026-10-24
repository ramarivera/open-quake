/** Independent WinZip AES AE-2 fixture encoder/decoder built from the format specification.
 * Used only by tests. No vendor bundle is executed and no password is printed. */
import {
	createCipheriv,
	createHmac,
	pbkdf2Sync,
	timingSafeEqual,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { backupPassword } from "./backup-archive";

function aesCtr(bytes: Uint8Array, key: Uint8Array): Buffer {
	const result = Buffer.alloc(bytes.length);
	for (
		let offset = 0, counter = 1;
		offset < bytes.length;
		offset += 16, counter++
	) {
		const nonce = Buffer.alloc(16);
		nonce.writeUInt32LE(counter);
		const cipher = createCipheriv("aes-256-ecb", key, null);
		cipher.setAutoPadding(false);
		const mask = cipher.update(nonce);
		for (let i = 0; i < 16 && offset + i < bytes.length; i++)
			result[offset + i] = (bytes[offset + i] ?? 0) ^ (mask[i] ?? 0);
	}
	return result;
}
export function referenceArchive(
	files: ReadonlyMap<string, Uint8Array>,
	account = "default",
): Uint8Array {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, bytes] of files) {
		const filename = Buffer.from(name);
		const salt = Buffer.alloc(16, 0x42);
		const keys = pbkdf2Sync(backupPassword(account), salt, 1000, 66, "sha1");
		const packed = deflateRawSync(bytes, { level: 9 });
		const encrypted = aesCtr(packed, keys.subarray(0, 32));
		const auth = createHmac("sha1", keys.subarray(32, 64))
			.update(encrypted)
			.digest()
			.subarray(0, 10);
		const data = Buffer.concat([salt, keys.subarray(64, 66), encrypted, auth]);
		const extra = Buffer.from([0x01, 0x99, 7, 0, 2, 0, 0x41, 0x45, 3, 8, 0]);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50);
		local.writeUInt16LE(51, 4);
		local.writeUInt16LE(0x801, 6);
		local.writeUInt16LE(99, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(bytes.length, 22);
		local.writeUInt16LE(filename.length, 26);
		local.writeUInt16LE(extra.length, 28);
		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50);
		header.writeUInt16LE(0x333, 4);
		header.writeUInt16LE(51, 6);
		header.writeUInt16LE(0x801, 8);
		header.writeUInt16LE(99, 10);
		header.writeUInt32LE(data.length, 20);
		header.writeUInt32LE(bytes.length, 24);
		header.writeUInt16LE(filename.length, 28);
		header.writeUInt16LE(extra.length, 30);
		header.writeUInt32LE((0o100600 << 16) >>> 0, 38);
		header.writeUInt32LE(offset, 42);
		const block = Buffer.concat([local, filename, extra, data]);
		locals.push(block);
		central.push(Buffer.concat([header, filename, extra]));
		offset += block.length;
	}
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(files.size, 8);
	end.writeUInt16LE(files.size, 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, directory, end]);
}
export function referenceDecode(
	bytes: Uint8Array,
	account = "default",
): ReadonlyMap<string, Uint8Array> {
	const zip = Buffer.from(bytes);
	const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	let cursor = zip.readUInt32LE(end + 16);
	const count = zip.readUInt16LE(end + 10);
	const files = new Map<string, Uint8Array>();
	for (let i = 0; i < count; i++) {
		const size = zip.readUInt32LE(cursor + 20);
		const nameLength = zip.readUInt16LE(cursor + 28);
		const extraLength = zip.readUInt16LE(cursor + 30);
		const commentLength = zip.readUInt16LE(cursor + 32);
		const local = zip.readUInt32LE(cursor + 42);
		const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString();
		if (zip.readUInt16LE(cursor + 10) !== 99)
			throw new Error("Expected AES entry");
		const dataStart =
			local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
		const data = zip.subarray(dataStart, dataStart + size);
		const keys = pbkdf2Sync(
			backupPassword(account),
			data.subarray(0, 16),
			1000,
			66,
			"sha1",
		);
		if (!timingSafeEqual(keys.subarray(64, 66), data.subarray(16, 18)))
			throw new Error("Password verification failed");
		const encrypted = data.subarray(18, -10);
		const auth = createHmac("sha1", keys.subarray(32, 64))
			.update(encrypted)
			.digest()
			.subarray(0, 10);
		if (!timingSafeEqual(auth, data.subarray(-10)))
			throw new Error("Authentication failed");
		files.set(name, inflateRawSync(aesCtr(encrypted, keys.subarray(0, 32))));
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	return files;
}

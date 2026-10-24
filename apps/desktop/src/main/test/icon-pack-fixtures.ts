// Stored ZIP fixture builder keeps archive layout and CRC checks under test.
const crc = (data: Buffer): number => {
	let n = 0xffffffff;
	for (const byte of data) {
		n ^= byte;
		for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
	}
	return (n ^ 0xffffffff) >>> 0;
};
export function iconZip(
	entries: readonly { name: string; data: string | Buffer }[],
): Buffer {
	const locals: Buffer[] = [],
		central: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name),
			data = Buffer.from(entry.data),
			check = crc(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(check, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		locals.push(local, name, data);
		const header = Buffer.alloc(46);
		header.writeUInt32LE(0x02014b50);
		header.writeUInt16LE(20, 4);
		header.writeUInt32LE(check, 16);
		header.writeUInt32LE(data.length, 20);
		header.writeUInt32LE(data.length, 24);
		header.writeUInt16LE(name.length, 28);
		header.writeUInt32LE(offset, 42);
		central.push(header, name);
		offset += local.length + name.length + data.length;
	}
	const cd = Buffer.concat(central),
		end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, end]);
}

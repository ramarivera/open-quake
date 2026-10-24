/** Independent synthetic UF2 bytes. No IO, firmware payload, or device access. */
export function syntheticUf2(blocks = 2): Uint8Array {
	const bytes = new Uint8Array(blocks * 512);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < blocks; i++) {
		const offset = i * 512;
		for (const [field, value] of [
			[0, 0x0a324655],
			[4, 0x9e5d5157],
			[8, 0x2000],
			[12, 0x12000 + i * 256],
			[16, 256],
			[20, i],
			[24, blocks],
			[28, 0x1aa143c7],
			[508, 0x0ab16f30],
		])
			if (field !== undefined && value !== undefined)
				view.setUint32(offset + field, value, true);
		bytes.fill(i + 1, offset + 32, offset + 288);
	}
	return bytes;
}

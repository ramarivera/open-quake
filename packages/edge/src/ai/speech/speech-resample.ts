/** Stateful linear PCM conversion. Input is aligned signed little-endian mono. */
export function pcmResampler(source: number, target: number) {
	let pending: number[] = [];
	let position = 0;
	return (bytes: Uint8Array, final = false): Uint8Array => {
		const input = new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength,
		);
		for (let i = 0; i < bytes.length; i += 2)
			pending.push(input.getInt16(i, true));
		const values: number[] = [];
		while (
			position < pending.length * target &&
			(final || Math.ceil(position / target) < pending.length)
		) {
			const i = Math.floor(position / target);
			const a = pending[i] ?? 0;
			const b = pending[Math.min(i + 1, pending.length - 1)] ?? a;
			values.push(Math.round(a + (b - a) * (position / target - i)));
			position += source;
		}
		const consumed = Math.min(Math.floor(position / target), pending.length);
		pending = pending.slice(consumed);
		position -= consumed * target;
		const result = new Uint8Array(values.length * 2);
		const view = new DataView(result.buffer);
		values.forEach((v, i) => {
			view.setInt16(i * 2, v, true);
		});
		return result;
	};
}

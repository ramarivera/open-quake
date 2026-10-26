import type { QuakeEvent } from "../../../preload/quake";

// Inspect JPEG frame dimensions before allowing the browser to allocate decoded pixels.
// DNL/zero-height and multiple-frame streams are rejected rather than guessed.
function boundedJpeg(bytes: readonly number[]): boolean {
	let offset = 2;
	let framed = false;
	while (offset + 3 < bytes.length) {
		if (bytes[offset++] !== 0xff) return false;
		while (bytes[offset] === 0xff) offset++;
		const marker = bytes[offset++];
		const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0);
		if (length < 2 || offset + length > bytes.length - 2) return false;
		if (marker === 0xda) return framed;
		if (
			marker !== undefined &&
			marker >= 0xc0 &&
			marker <= 0xcf &&
			![0xc4, 0xc8, 0xcc].includes(marker)
		) {
			const height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0);
			const width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0);
			const components = bytes[offset + 7] ?? 0;
			if (
				framed ||
				bytes[offset + 2] !== 8 ||
				!width ||
				!height ||
				width * height > 64_000_000 ||
				components < 1 ||
				components > 4 ||
				length !== 8 + 3 * components
			)
				return false;
			framed = true;
		}
		offset += length;
	}
	return false;
}

/** Bounded per-cell resource assembly. Sequence zero completes a JPEG. */
export function createStripResourceReceiver(
	publish: (keyCode: string, dataUrl: string) => void,
) {
	const pending = new Map<
		string,
		{ sequence: number; type: number; bytes: readonly number[] }
	>();
	return {
		reset: () => pending.clear(),
		accept(event: QuakeEvent): void {
			if (event.kind === "status" && event.state !== "connected") {
				pending.clear();
				return;
			}
			if (event.kind !== "resource" || event.envelope.opCode !== 2) return;
			const { metadata, sequence, payload } = event.envelope;
			const [type, row, col] = metadata;
			if (row < 1 || row > 2 || col < 1 || col > 8) return;
			const key = `${row},${col}`;
			const old = pending.get(key);
			if (
				sequence !== 0 &&
				sequence !== 1 &&
				(!old || old.sequence + 1 !== sequence || old.type !== type)
			) {
				pending.delete(key);
				return;
			}
			const bytes = [...(sequence === 1 ? [] : (old?.bytes ?? [])), ...payload];
			if (bytes.length > 8 * 1024 * 1024) {
				pending.delete(key);
				return;
			}
			if (sequence) {
				pending.set(key, { sequence, type, bytes });
				return;
			}
			pending.delete(key);
			if (old && old.type !== type) return;
			if (
				bytes[0] !== 0xff ||
				bytes[1] !== 0xd8 ||
				bytes.at(-2) !== 0xff ||
				bytes.at(-1) !== 0xd9 ||
				!boundedJpeg(bytes)
			)
				return;
			let text = "";
			for (let offset = 0; offset < bytes.length; offset += 8192)
				text += String.fromCharCode(...bytes.slice(offset, offset + 8192));
			publish(key, `data:image/jpeg;base64,${btoa(text)}`);
		},
	};
}

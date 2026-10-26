import type { QuakeEvent } from "../../../preload/quake";

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
				bytes.at(-1) !== 0xd9
			)
				return;
			let text = "";
			for (let offset = 0; offset < bytes.length; offset += 8192)
				text += String.fromCharCode(...bytes.slice(offset, offset + 8192));
			publish(key, `data:image/jpeg;base64,${btoa(text)}`);
		},
	};
}

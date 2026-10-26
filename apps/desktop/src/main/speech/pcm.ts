/** Stateful sample-area resampler. Its phase survives input block boundaries. */
export class PcmFramer {
	private weighted = 0;
	private weight = 0;
	private frame: number[] = [];
	private sequence = 0;
	constructor(
		readonly captureId: string,
		readonly inputRate: number,
	) {
		if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000)
			throw new RangeError("Unsupported capture rate");
	}
	push(channels: readonly Float32Array[]): readonly PcmFrame[] {
		if (!channels.length) return [];
		const count = channels[0]?.length ?? 0;
		if (channels.some((channel) => channel.length !== count))
			throw new RangeError("Unaligned channels");
		const frames: PcmFrame[] = [];
		const ratio = this.inputRate / 24000;
		for (let index = 0; index < count; index++) {
			let sample = 0;
			for (const channel of channels) sample += channel[index] ?? 0;
			sample = Math.max(-1, Math.min(1, sample / channels.length));
			if (!Number.isFinite(sample)) sample = 0;
			let remaining = 1;
			while (remaining > 1e-10) {
				const take = Math.min(remaining, ratio - this.weight);
				this.weighted += sample * take;
				this.weight += take;
				remaining -= take;
				if (this.weight >= ratio - 1e-10) {
					this.frame.push(this.weighted / ratio);
					this.weight = 0;
					this.weighted = 0;
					if (this.frame.length === 480) frames.push(this.emit());
				}
			}
		}
		return frames;
	}
	flush(): readonly PcmFrame[] {
		// Fractional trailing input is shorter than one output sample, discard it.
		this.weight = 0;
		this.weighted = 0;
		return this.frame.length ? [this.emit()] : [];
	}
	private emit(): PcmFrame {
		const bytes = new Uint8Array(this.frame.length * 2);
		const view = new DataView(bytes.buffer);
		let energy = 0;
		let peak = 0;
		for (let index = 0; index < this.frame.length; index++) {
			const sample = this.frame[index] ?? 0;
			energy += sample * sample;
			peak = Math.max(peak, Math.abs(sample));
			view.setInt16(
				index * 2,
				Math.round(sample * (sample < 0 ? 32768 : 32767)),
				true,
			);
		}
		const rms = Math.min(1, Math.sqrt(energy / this.frame.length));
		this.frame = [];
		return {
			captureId: this.captureId,
			seq: this.sequence++,
			bytes,
			rms,
			peak,
		};
	}
}
export interface PcmFrame {
	readonly captureId: string;
	readonly seq: number;
	readonly bytes: Uint8Array;
	readonly rms: number;
	readonly peak: number;
}

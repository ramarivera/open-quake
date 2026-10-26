/* Actual input rate -> exact 300 ms, 24 kHz mono s16le blocks. Output stays silent. */
class MeetingPcm extends AudioWorkletProcessor {
	constructor() {
		super();
		this.samples = new ArrayBuffer(14400);
		this.view = new DataView(this.samples);
		this.offset = 0;
		this.phase = 0;
		this.sum = 0;
		this.weight = 0;
	}
	process(inputs) {
		const channels = inputs[0];
		if (!channels?.length) return true;
		const ratio = sampleRate / 24000;
		for (let i = 0; i < channels[0].length; i++) {
			let sample = 0;
			for (const channel of channels)
				sample += (channel[i] ?? 0) / channels.length;
			let remaining = 1;
			while (remaining > 1e-9) {
				const used = Math.min(remaining, ratio - this.phase);
				this.sum += sample * used;
				this.weight += used;
				this.phase += used;
				remaining -= used;
				if (this.phase + 1e-9 >= ratio) {
					const value = Math.max(-1, Math.min(1, this.sum / this.weight));
					this.view.setInt16(
						this.offset * 2,
						Math.round(value < 0 ? value * 32768 : value * 32767),
						true,
					);
					this.offset++;
					this.phase = 0;
					this.sum = 0;
					this.weight = 0;
					if (this.offset === 7200) {
						this.port.postMessage(this.samples, [this.samples]);
						this.samples = new ArrayBuffer(14400);
						this.view = new DataView(this.samples);
						this.offset = 0;
					}
				}
			}
		}
		return true;
	}
}
registerProcessor("meeting-pcm", MeetingPcm);

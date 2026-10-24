/* Browser AudioWorklet scope. 300 ms of 24 kHz mono signed-16 PCM, no playback. */
class MeetingPcm extends AudioWorkletProcessor {
	constructor() {
		super();
		this.samples = new Int16Array(7200);
		this.offset = 0;
	}
	process(inputs) {
		const channels = inputs[0];
		if (!channels?.length) return true;
		for (let i = 0; i < channels[0].length; i++) {
			let sample = 0;
			for (const channel of channels) sample += channel[i] / channels.length;
			this.samples[this.offset++] = Math.round(
				Math.max(-1, Math.min(1, sample)) * 32767,
			);
			if (this.offset === 7200) {
				this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
				this.samples = new Int16Array(7200);
				this.offset = 0;
			}
		}
		return true;
	}
}
registerProcessor("meeting-pcm", MeetingPcm);

export type AmbientAudio = {
	state: "idle" | "live" | "silent" | "unavailable";
	low: number;
	mid: number;
	high: number;
};
export const idleAmbientAudio: AmbientAudio = {
	state: "idle",
	low: 0,
	mid: 0,
	high: 0,
};

/** Three real frequency bands. No recording or retained samples. */
export function spectrumEnergy(
	data: Uint8Array,
	sampleRate: number,
	fftSize: number,
): AmbientAudio {
	const mean = (from: number, to: number) => {
		const start = Math.max(1, Math.floor((from * fftSize) / sampleRate));
		const end = Math.min(data.length, Math.ceil((to * fftSize) / sampleRate));
		let total = 0;
		for (let index = start; index < end; index++) total += data[index] ?? 0;
		return end > start ? total / ((end - start) * 255) : 0;
	};
	const low = mean(30, 180),
		mid = mean(180, 2000),
		high = mean(2000, 12000);
	return {
		state: Math.max(low, mid, high) > 0.01 ? "live" : "silent",
		low,
		mid,
		high,
	};
}

type CapturableVideo = HTMLVideoElement & { captureStream?: () => MediaStream };
/** Analyze only the explicitly enabled background media. Existing playback owns audibility. */
export function observeAmbientAudio(
	video: CapturableVideo,
	update: (audio: AmbientAudio) => void,
): () => void {
	let context: AudioContext | undefined;
	let stream: MediaStream | undefined;
	let source: MediaStreamAudioSourceNode | undefined;
	let analyser: AnalyserNode | undefined;
	let sink: GainNode | undefined;
	let frame = 0;
	let disposed = false;
	let last = 0;
	const release = () => {
		cancelAnimationFrame(frame);
		source?.disconnect();
		analyser?.disconnect();
		sink?.disconnect();
		for (const track of stream?.getTracks() ?? []) track.stop();
		if (context) void context.close().catch(() => {});
		context = undefined;
		stream = undefined;
		source = undefined;
		analyser = undefined;
		sink = undefined;
	};
	const start = () => {
		if (disposed || context || video.paused || document.hidden) return;
		try {
			if (!video.captureStream || typeof AudioContext === "undefined")
				throw new Error("unsupported");
			stream = video.captureStream();
			if (!stream.getAudioTracks().length) throw new Error("no-audio");
			context = new AudioContext();
			source = context.createMediaStreamSource(stream);
			analyser = context.createAnalyser();
			analyser.fftSize = 2048;
			sink = context.createGain();
			sink.gain.value = 0;
			source.connect(analyser);
			analyser.connect(sink);
			sink.connect(context.destination);
			const ownedContext = context;
			void context.resume().catch(() => {
				if (!disposed && context === ownedContext) {
					release();
					update({ ...idleAmbientAudio, state: "unavailable" });
				}
			});
			const bins = new Uint8Array(analyser.frequencyBinCount);
			const tick = (time: number) => {
				if (disposed || !analyser || !context) return;
				if (time - last >= 66) {
					analyser.getByteFrequencyData(bins);
					update(spectrumEnergy(bins, context.sampleRate, analyser.fftSize));
					last = time;
				}
				frame = requestAnimationFrame(tick);
			};
			frame = requestAnimationFrame(tick);
		} catch {
			release();
			update({ ...idleAmbientAudio, state: "unavailable" });
		}
	};
	const pause = () => {
		release();
		if (!disposed) update(idleAmbientAudio);
	};
	const visibility = () => {
		if (document.hidden) pause();
		else start();
	};
	video.addEventListener("playing", start);
	video.addEventListener("pause", pause);
	video.addEventListener("ended", pause);
	document.addEventListener("visibilitychange", visibility);
	start();
	return () => {
		disposed = true;
		video.removeEventListener("playing", start);
		video.removeEventListener("pause", pause);
		video.removeEventListener("ended", pause);
		document.removeEventListener("visibilitychange", visibility);
		release();
	};
}

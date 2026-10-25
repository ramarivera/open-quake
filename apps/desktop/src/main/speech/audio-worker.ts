import { PcmFramer } from "./pcm";

/** Serialized into an isolated, sandboxed file-origin worker. No Node or credential access. */
export function installAudioWorker(Framer: typeof PcmFramer) {
	let context: AudioContext | undefined;
	let tracks: MediaStream | undefined;
	let processor: ScriptProcessorNode | undefined;
	let source: MediaStreamAudioSourceNode | AudioBufferSourceNode | undefined;
	let frames: ReturnType<PcmFramer["push"]>[number][] = [];
	let stopped = false;
	let generation = 0;
	let failed: false | "overflow" | "recorder" = false;
	let framer: PcmFramer | undefined;
	const stop = async () => {
		stopped = true;
		for (const track of tracks?.getTracks() ?? []) {
			track.onended = null;
			track.stop();
		}
		tracks = undefined;
		processor?.disconnect();
		if (processor) processor.onaudioprocess = null;
		processor = undefined;
		if (source instanceof AudioBufferSourceNode) {
			source.onended = null;
			source.stop();
		}
		source?.disconnect();
		source = undefined;
		if (framer && !failed) frames.push(...framer.flush());
		framer = undefined;
		await context?.close();
		context = undefined;
	};
	const api = {
		async capture(id: string) {
			const epoch = ++generation;
			stopped = false;
			failed = false;
			frames = [];
			const granted = await navigator.mediaDevices.getUserMedia({
				audio: {
					channelCount: 1,
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: false,
				},
				video: false,
			});
			if (epoch !== generation || stopped) {
				for (const track of granted.getTracks()) track.stop();
				return;
			}
			tracks = granted;
			for (const track of granted.getAudioTracks())
				track.onended = () => {
					failed = "recorder";
					void stop();
				};
			context = new AudioContext();
			framer = new Framer(id, context.sampleRate);
			source = context.createMediaStreamSource(granted);
			processor = context.createScriptProcessor(1024, 1, 1);
			processor.onaudioprocess = (event) => {
				if (stopped || !framer) return;
				frames.push(...framer.push([event.inputBuffer.getChannelData(0)]));
				if (frames.length > 249) {
					failed = "overflow";
					frames = [];
					void stop();
				}
			};
			source.connect(processor);
			processor.connect(context.destination);
			await context.resume();
		},
		pull() {
			const batch = {
				frames: frames
					.splice(0, 1)
					.map((frame) => ({ ...frame, bytes: Array.from(frame.bytes) })),
				done: stopped && !frames.length,
				failed,
			};
			return batch;
		},
		async ready() {
			context = new AudioContext({ sampleRate: 24000 });
			await context.resume();
		},
		async play(bytes: number[]) {
			if (!context || stopped) throw new Error("Player closed");
			const buffer = context.createBuffer(1, bytes.length / 2, 24000);
			const view = new DataView(Uint8Array.from(bytes).buffer);
			const samples = buffer.getChannelData(0);
			for (let index = 0; index < samples.length; index++)
				samples[index] = view.getInt16(index * 2, true) / 32768;
			const player = context.createBufferSource();
			source = player;
			player.buffer = buffer;
			player.connect(context.destination);
			await new Promise<void>((resolve) => {
				player.onended = () => {
					if (!stopped) resolve();
				};
				player.start();
			});
		},
		async stop() {
			generation++;
			await stop();
		},
	};
	Object.assign(globalThis, { __quakeSpeech: api });
}
export const audioWorkerSource = () =>
	`(${installAudioWorker.toString()})(${PcmFramer.toString()})`;

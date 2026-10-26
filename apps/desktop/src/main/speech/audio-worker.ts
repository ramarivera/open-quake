import {
	type MicrophoneIdentity,
	recoverMicrophone,
} from "../../shared/speech";
import { PcmFramer } from "./pcm";

/** Serialized into an isolated, sandboxed file-origin worker. No Node or credential access. */
export function installAudioWorker(
	Framer: typeof PcmFramer,
	recover: typeof recoverMicrophone,
) {
	let localActive = false;
	let localStatus = { started: false, done: false, failed: false };
	let cancelVoiceWait: (() => void) | undefined;
	let context: AudioContext | undefined;
	let tracks: MediaStream | undefined;
	let processor: ScriptProcessorNode | undefined;
	let source: MediaStreamAudioSourceNode | AudioBufferSourceNode | undefined;
	let frames: ReturnType<PcmFramer["push"]>[number][] = [];
	let stopped = false;
	let paused = false;
	let archive: number[] | undefined;
	let lastLevel = { rms: 0, peak: 0 };
	const retain = (batch: ReturnType<PcmFramer["push"]>) => {
		frames.push(...batch);
		for (const frame of batch) {
			lastLevel = { rms: frame.rms, peak: frame.peak };
			if (archive) {
				const remaining = 24000 * 2 * 60 - archive.length;
				for (const byte of frame.bytes.subarray(0, remaining))
					archive.push(byte);
			}
		}
	};
	let generation = 0;
	let failed: false | "overflow" | "recorder" = false;
	let framer: PcmFramer | undefined;
	const stop = async () => {
		cancelVoiceWait?.();
		if (localActive) {
			localActive = false;
			localStatus = { ...localStatus, failed: true };
			speechSynthesis.cancel();
		}
		stopped = true;
		const ownedTracks = tracks;
		const ownedProcessor = processor;
		const ownedSource = source;
		const ownedFramer = framer;
		const ownedContext = context;
		tracks = undefined;
		processor = undefined;
		source = undefined;
		framer = undefined;
		context = undefined;
		try {
			for (const track of ownedTracks?.getTracks() ?? []) {
				track.onended = null;
				track.stop();
			}
			if (ownedProcessor) ownedProcessor.onaudioprocess = null;
			ownedProcessor?.disconnect();
			if (ownedSource instanceof AudioBufferSourceNode) {
				ownedSource.onended = null;
				ownedSource.stop();
			}
			ownedSource?.disconnect();
			if (ownedFramer && !failed) retain(ownedFramer.flush());
		} finally {
			lastLevel = { rms: 0, peak: 0 };
			await ownedContext?.close();
		}
	};
	const api = {
		async capture(
			id: string,
			microphone?: MicrophoneIdentity,
			exportRecording = false,
		) {
			const epoch = ++generation;
			stopped = false;
			failed = false;
			frames = [];
			paused = false;
			archive = exportRecording ? [] : undefined;
			const devices =
				microphone && microphone.deviceId !== "default"
					? await navigator.mediaDevices.enumerateDevices()
					: [];
			const selected = microphone
				? recover(
						// groupId belongs to the settings document, not this worker.
						{ ...microphone, groupId: "" },
						devices.filter((d) => d.kind === "audioinput"),
					)
				: undefined;
			const deviceId = selected?.deviceId ?? microphone?.deviceId ?? "default";
			if (epoch !== generation || stopped) return;
			const granted = await navigator.mediaDevices.getUserMedia({
				audio: {
					...(deviceId === "default" ? {} : { deviceId: { exact: deviceId } }),
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
			if (!granted.getAudioTracks().length) {
				await stop();
				throw Object.assign(new Error("No microphone input"), {
					name: "NotFoundError",
				});
			}
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
				if (stopped || paused || !framer) return;
				try {
					retain(framer.push([event.inputBuffer.getChannelData(0)]));
				} catch {
					failed = "overflow";
				}
				if (failed || frames.length > 249) {
					failed = "overflow";
					frames = [];
					void stop();
				}
			};
			source.connect(processor);
			processor.connect(context.destination);
			await context.resume();
		},
		pause() {
			paused = true;
			lastLevel = { rms: 0, peak: 0 };
		},
		resumeCapture() {
			if (!stopped) paused = false;
		},
		level() {
			return lastLevel;
		},
		export(format: "pcm" | "wav" | "blob") {
			if (!stopped || !archive || failed)
				throw new Error("Recording export unavailable");
			if (format === "pcm") return archive.slice();
			const bytes = new Uint8Array(44 + archive.length);
			const view = new DataView(bytes.buffer);
			const text = (at: number, value: string) => {
				for (let i = 0; i < value.length; i++)
					bytes[at + i] = value.charCodeAt(i);
			};
			text(0, "RIFF");
			view.setUint32(4, bytes.length - 8, true);
			text(8, "WAVE");
			text(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, 24000, true);
			view.setUint32(28, 48000, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			text(36, "data");
			view.setUint32(40, archive.length, true);
			bytes.set(archive, 44);
			return format === "blob"
				? new Blob([bytes], { type: "audio/wav" })
				: Array.from(bytes);
		},
		async close() {
			generation++;
			await stop();
			frames = [];
			archive = undefined;
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
		async speakLocal(
			text: string,
			settings: {
				rate: number;
				pitch: number;
				volume: number;
				voiceHint: string;
			},
		) {
			cancelVoiceWait?.();
			const epoch = ++generation;
			localStatus = { started: false, done: false, failed: false };
			let voices = speechSynthesis.getVoices();
			if (!voices.length) {
				voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
					const finish = (available: SpeechSynthesisVoice[]) => {
						clearTimeout(timer);
						speechSynthesis.removeEventListener("voiceschanged", changed);
						cancelVoiceWait = undefined;
						resolve(available);
					};
					const changed = () => {
						const available = speechSynthesis.getVoices();
						if (available.length) finish(available);
					};
					const timer = setTimeout(
						() => finish(speechSynthesis.getVoices()),
						1000,
					);
					cancelVoiceWait = () => finish([]);
					speechSynthesis.addEventListener("voiceschanged", changed);
					changed();
				});
			}
			if (epoch !== generation) return;
			const hint = settings.voiceHint.toLowerCase().trim();
			const voice = hint
				? voices.find((v) => v.name.toLowerCase().includes(hint))
				: (voices.find((v) => v.lang.startsWith("zh")) ?? voices[0]);
			if (!voice)
				throw Object.assign(new Error("Local voice unavailable"), {
					name: "VoiceUnavailable",
				});
			const utterance = new SpeechSynthesisUtterance(text);
			utterance.voice = voice;
			utterance.rate = Math.max(0.5, Math.min(2, settings.rate));
			utterance.pitch = Math.max(0, Math.min(2, settings.pitch));
			utterance.volume = Math.max(0, Math.min(1, settings.volume));
			localActive = true;
			localStatus = { started: false, done: false, failed: false };
			utterance.onstart = () => {
				if (generation === epoch && localActive) localStatus.started = true;
			};
			utterance.onend = () => {
				if (generation !== epoch || !localActive) return;
				localStatus.done = true;
				localActive = false;
			};
			utterance.onerror = () => {
				if (generation !== epoch) return;
				localStatus.failed = true;
				localActive = false;
			};
			speechSynthesis.speak(utterance);
		},
		localState() {
			return { ...localStatus };
		},
		async ready() {
			context = new AudioContext({ sampleRate: 24000 });
			await context.resume();
		},
		state() {
			return context?.state ?? "closed";
		},
		async resume() {
			await context?.resume();
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
	`(${installAudioWorker.toString()})(${PcmFramer.toString()}, ${recoverMicrophone.toString()})`;

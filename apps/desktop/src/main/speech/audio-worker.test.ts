import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { MicrophoneIdentity } from "../../shared/speech";
import { audioWorkerSource } from "./audio-worker";

interface WorkerApi {
	capture(
		id: string,
		microphone?: MicrophoneIdentity,
		exportRecording?: boolean,
	): Promise<void>;
	pull(): {
		frames: {
			captureId: string;
			seq: number;
			bytes: number[];
			rms: number;
			peak: number;
		}[];
		done: boolean;
		failed: false | "overflow" | "recorder";
	};
	stop(): Promise<void>;
	pause(): void;
	resumeCapture(): void;
	close(): Promise<void>;
	level(): { rms: number; peak: number };
	export(format: "pcm" | "wav"): number[];
	export(format: "blob"): Blob;
	ready(): Promise<void>;
	play(bytes: number[]): Promise<void>;
}
function worker(
	grant?: Promise<unknown>,
	options: {
		devices?: readonly MicrophoneIdentity[];
		error?: string;
		disconnectError?: boolean;
	} = {},
) {
	const constraints: MediaStreamConstraints[] = [];
	let stopped = 0,
		closed = 0;
	const track = {
		stop: () => {
			stopped++;
		},
		onended: null,
	};
	const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
	let process:
		| ((event: {
				inputBuffer: { getChannelData: (channel: number) => Float32Array };
		  }) => void)
		| null = null;
	let player: Source | undefined;
	class Source {
		onended: (() => void) | null = null;
		buffer: unknown;
		connect() {}
		disconnect() {
			if (options.disconnectError) throw new Error("synthetic disconnect");
		}
		start() {}
		stop() {}
	}
	class Context {
		sampleRate = 48000;
		destination = {};
		createMediaStreamSource() {
			return new Source();
		}
		createScriptProcessor() {
			return {
				connect() {},
				disconnect() {},
				get onaudioprocess() {
					return process;
				},
				set onaudioprocess(value: typeof process) {
					process = value;
				},
			};
		}
		createBuffer(_channels: number, count: number) {
			return { getChannelData: () => new Float32Array(count) };
		}
		createBufferSource() {
			player = new Source();
			return player;
		}
		async resume() {}
		async close() {
			closed++;
		}
	}
	const context = {
		navigator: {
			mediaDevices: {
				enumerateDevices: async () =>
					(options.devices ?? []).map((d) => ({ ...d, kind: "audioinput" })),
				getUserMedia: async (input: MediaStreamConstraints) => {
					constraints.push(input);
					if (options.error)
						throw Object.assign(new Error("private"), { name: options.error });
					await grant;
					return stream;
				},
			},
		},
		AudioContext: Context,
		AudioBufferSourceNode: Source,
		Uint8Array,
		Float32Array,
		DataView,
		Math,
		Number,
		RangeError,
		Array,
		Promise,
		Object,
		Blob,
	};
	runInNewContext(audioWorkerSource(), context);
	const api = (context as typeof context & { __quakeSpeech: WorkerApi })
		.__quakeSpeech;
	return {
		api,
		constraints,
		counts: () => ({ stopped, closed }),
		feed: (samples: Float32Array) =>
			process?.({ inputBuffer: { getChannelData: () => samples } }),
		end: () => player?.onended?.(),
	};
}
describe("actual serialized WebAudio worker with synthetic devices", () => {
	it("captures 48kHz into correlated 20ms frames and stops physical tracks before final tail drain", async () => {
		const { api, feed, counts } = worker();
		await api.capture("one");
		feed(new Float32Array(1024).fill(0.25));
		await api.stop();
		expect(counts()).toEqual({ stopped: 1, closed: 1 });
		const first = api.pull();
		expect(first.frames[0]).toMatchObject({
			captureId: "one",
			seq: 0,
			rms: 0.25,
			peak: 0.25,
		});
		expect(first.frames[0]?.bytes).toHaveLength(960);
		expect(first.done).toBe(false);
		const tail = api.pull();
		expect(tail.frames[0]?.bytes).toHaveLength(64);
		expect(tail.frames[0]?.seq).toBe(1);
		expect(tail.done).toBe(true);
	});
	it("stops a late permission grant without creating an audio context", async () => {
		let grant: (() => void) | undefined;
		const promise = new Promise<void>((resolve) => {
			grant = resolve;
		});
		const { api, counts } = worker(promise);
		const opening = api.capture("early");
		await api.stop();
		grant?.();
		await opening;
		expect(counts()).toEqual({ stopped: 1, closed: 0 });
		expect(api.pull().frames).toEqual([]);
	});
	it("fails explicitly on a five-second queue overflow and releases the tracks", async () => {
		const { api, feed, counts } = worker();
		await api.capture("full");
		feed(new Float32Array(241000).fill(0.1));
		await Promise.resolve();
		expect(api.pull().failed).toBe("overflow");
		expect(counts()).toEqual({ stopped: 1, closed: 1 });
	});
	it("resolves only on natural source end, cancellation cannot resolve playback", async () => {
		const { api, end, counts } = worker();
		await api.ready();
		let completed = false;
		const playing = api.play(Array(960).fill(0)).then(() => {
			completed = true;
		});
		await Promise.resolve();
		expect(completed).toBe(false);
		end();
		await playing;
		expect(completed).toBe(true);
		await api.stop();
		expect(counts().closed).toBe(1);
		const second = worker();
		await second.api.ready();
		let cancelledCompleted = false;
		void second.api.play([0, 0]).then(() => {
			cancelledCompleted = true;
		});
		await second.api.stop();
		second.end();
		await Promise.resolve();
		expect(cancelledCompleted).toBe(false);
	});
});

it("uses recovered exact identity and never retries missing or denied microphones with another input", async () => {
	const saved = { deviceId: "old", label: "Desk", groupId: "group" };
	const f = worker(undefined, { devices: [{ ...saved, deviceId: "new" }] });
	await f.api.capture("selected", saved);
	expect(f.constraints).toEqual([
		{
			audio: {
				deviceId: { exact: "new" },
				channelCount: 1,
				echoCancellation: true,
				noiseSuppression: true,
				autoGainControl: false,
			},
			video: false,
		},
	]);
	await f.api.stop();
	for (const error of [
		"NotFoundError",
		"NotAllowedError",
		"NotReadableError",
	]) {
		const failed = worker(undefined, { error });
		await expect(failed.api.capture("failed", saved)).rejects.toHaveProperty(
			"name",
			error,
		);
		expect(failed.constraints).toHaveLength(1);
		expect(failed.constraints[0]?.audio).toMatchObject({
			deviceId: { exact: "old" },
		});
	}
	const defaultMic = worker();
	await defaultMic.api.capture("default");
	expect(defaultMic.constraints[0]?.audio).not.toHaveProperty("deviceId");
	await defaultMic.api.stop();
});
it("pauses without ending, exports opt-in PCM/WAV/Blob after stop and forgets it on close", async () => {
	const f = worker();
	await f.api.capture("export", undefined, true);
	f.feed(new Float32Array(960).fill(0.25));
	expect(f.api.level().rms).toBe(0.25);
	f.api.pause();
	f.feed(new Float32Array(960).fill(1));
	expect(f.api.level()).toEqual({ rms: 0, peak: 0 });
	expect(f.counts()).toEqual({ stopped: 0, closed: 0 });
	f.api.resumeCapture();
	f.feed(new Float32Array(960).fill(-0.5));
	await f.api.stop();
	expect(f.api.level()).toEqual({ rms: 0, peak: 0 });
	expect(f.api.export("pcm")).toHaveLength(1920);
	const wav = Uint8Array.from(f.api.export("wav"));
	const header = new DataView(wav.buffer);
	expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
	expect(header.getUint32(24, true)).toBe(24000);
	expect(header.getUint16(22, true)).toBe(1);
	expect(header.getUint16(34, true)).toBe(16);
	expect(header.getUint32(40, true)).toBe(1920);
	expect(new Uint8Array(await f.api.export("blob").arrayBuffer())).toEqual(wav);
	expect(f.api.pull().frames[0]?.seq).toBe(0);
	expect(f.api.pull().frames[0]?.seq).toBe(1);
	await f.api.close();
	expect(() => f.api.export("pcm")).toThrow();
	const regular = worker();
	await regular.api.capture("normal");
	await regular.api.stop();
	expect(() => regular.api.export("pcm")).toThrow();
});

it.each([48, 1008])(
	"exports a bounded archive and closes capture after 60 seconds plus %i input samples",
	async (tailSamples) => {
		const f = worker();
		await f.api.capture("bounded", undefined, true);
		const input = new Float32Array(960).fill(0.25);
		for (let i = 0; i < 3000; i++) {
			f.feed(input);
			f.api.pull();
		}
		f.feed(new Float32Array(tailSamples).fill(0.5));
		await expect(f.api.stop()).resolves.toBeUndefined();
		expect(f.counts()).toEqual({ stopped: 1, closed: 1 });
		expect(f.api.pull().failed).toBe(false);
		const pcm = f.api.export("pcm");
		expect(pcm).toHaveLength(24000 * 2 * 60);
		expect(pcm.slice(-2)).toEqual([0, 32]);
		const wav = Uint8Array.from(f.api.export("wav"));
		expect(wav).toHaveLength(pcm.length + 44);
		expect(new DataView(wav.buffer).getUint32(40, true)).toBe(pcm.length);
		await f.api.close();
		expect(f.counts()).toEqual({ stopped: 1, closed: 1 });
	},
);

it("closes the audio context even when native graph teardown rejects", async () => {
	const f = worker(undefined, { disconnectError: true });
	await f.api.capture("cleanup", undefined, true);
	await expect(f.api.stop()).rejects.toThrow("synthetic disconnect");
	expect(f.counts()).toEqual({ stopped: 1, closed: 1 });
	await f.api.close();
	expect(f.counts()).toEqual({ stopped: 1, closed: 1 });
});

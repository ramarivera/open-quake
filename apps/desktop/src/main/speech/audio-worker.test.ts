import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { audioWorkerSource } from "./audio-worker";

interface WorkerApi {
	capture(id: string): Promise<void>;
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
	ready(): Promise<void>;
	play(bytes: number[]): Promise<void>;
}
function worker(grant?: Promise<unknown>) {
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
		disconnect() {}
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
				getUserMedia: async () => {
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
	};
	runInNewContext(audioWorkerSource(), context);
	const api = (context as typeof context & { __quakeSpeech: WorkerApi })
		.__quakeSpeech;
	return {
		api,
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

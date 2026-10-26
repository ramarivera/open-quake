import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	CaptureRequest,
	MeetingsBridge,
} from "../../../shared/meeting-bridge";
import { createMeetingCapture } from "./capture";

class Track extends EventTarget implements MediaStreamTrack {
	readonly id = "mic";
	readonly kind = "audio";
	readonly label = "Test microphone";
	readonly muted = false;
	enabled = true;
	contentHint = "";
	readyState: MediaStreamTrackState = "live";
	onended: MediaStreamTrack["onended"] = null;
	onmute: MediaStreamTrack["onmute"] = null;
	onunmute: MediaStreamTrack["onunmute"] = null;
	stop = vi.fn(() => {
		this.readyState = "ended";
	});
	clone = () => new Track();
	applyConstraints = async () => {};
	getCapabilities = () => ({});
	getConstraints = () => ({});
	getSettings = () => ({});
}
class AudioStream extends EventTarget implements MediaStream {
	readonly id = "stream";
	readonly active = true;
	onaddtrack: MediaStream["onaddtrack"] = null;
	onremovetrack: MediaStream["onremovetrack"] = null;
	constructor(readonly track = new Track()) {
		super();
	}
	getTracks = () => [this.track];
	getAudioTracks = () => [this.track];
	getVideoTracks = (): MediaStreamTrack[] => [];
	getTrackById = () => this.track;
	clone = () => new AudioStream();
	addTrack = () => {};
	removeTrack = () => {};
}
class Recorder {
	static all: Recorder[] = [];
	state: RecordingState = "inactive";
	ondataavailable: ((event: { data: Blob }) => void) | undefined;
	onstop: (() => void) | undefined;
	constructor(
		readonly stream: MediaStream,
		readonly options: MediaRecorderOptions,
	) {
		Recorder.all.push(this);
	}
	start = vi.fn((_ms: number) => {
		this.state = "recording";
	});
	stop = vi.fn(() => {
		this.state = "inactive";
		this.ondataavailable?.({ data: new Blob(["audio"]) });
		this.onstop?.();
	});
}
const request = (
	operation: CaptureRequest["operation"],
	id: string,
	extra = {},
): CaptureRequest => ({
	requestId: crypto.randomUUID(),
	operation,
	id,
	microphoneId: "chosen-mic",
	systemAudio: false,
	...extra,
});
function setup() {
	Recorder.all = [];
	vi.stubGlobal("MediaRecorder", Recorder);
	const stream = new AudioStream(),
		system = new AudioStream(new Track());
	const media = {
		getUserMedia: vi.fn(async () => stream),
		getDisplayMedia: vi.fn(async () => system),
	};
	const bridge: MeetingsBridge = {
		request: vi.fn(),
		onSnapshot: () => () => {},
		onCapture: () => () => {},
		captureReply: vi.fn(),
		writeChunk: vi.fn(async () => {}),
		pcm: vi.fn(async () => {}),
		sourceLost: vi.fn(),
	};
	return {
		bridge,
		media,
		stream,
		system,
		capture: createMeetingCapture(bridge, media),
	};
}
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
describe("real meeting recorder consumer with fake media devices", () => {
	it("shares streams with side records, flushes once and releases tracks only with the main owner", async () => {
		const f = setup();
		await f.capture.handle(request("start", "main"));
		await f.capture.handle(request("start", "side", { parentId: "main" }));
		expect(f.media.getUserMedia).toHaveBeenCalledExactlyOnceWith({
			audio: { deviceId: { exact: "chosen-mic" } },
			video: false,
		});
		expect(Recorder.all).toHaveLength(2);
		expect(Recorder.all[0]?.start).toHaveBeenCalledWith(10000);
		await f.capture.handle(request("stop", "side"));
		expect(f.stream.track.stop).not.toHaveBeenCalled();
		await f.capture.handle(request("stop", "main"));
		await f.capture.handle(request("stop", "main"));
		expect(f.stream.track.stop).toHaveBeenCalledTimes(1);
		expect(f.bridge.writeChunk).toHaveBeenCalledTimes(2);
		f.capture.dispose();
	});
	it("releases an acquired microphone when explicit system capture fails and never falls back", async () => {
		const f = setup();
		f.media.getDisplayMedia.mockRejectedValueOnce(
			new Error("permission denied"),
		);
		await f.capture.handle(request("start", "main", { systemAudio: true }));
		expect(f.stream.track.stop).toHaveBeenCalledTimes(1);
		expect(f.bridge.captureReply).toHaveBeenLastCalledWith(
			expect.objectContaining({ success: false }),
		);
		expect(Recorder.all).toHaveLength(0);
		f.capture.dispose();
	});
	it("settles missing recorder onstop with failure and still releases tracks", async () => {
		vi.useFakeTimers();
		const f = setup();
		await f.capture.handle(request("start", "main"));
		const recorder = Recorder.all[0];
		if (!recorder) throw new Error("No recorder");
		recorder.stop = vi.fn();
		const stopping = f.capture.handle(request("stop", "main"));
		await vi.advanceTimersByTimeAsync(2000);
		await stopping;
		expect(f.stream.track.stop).toHaveBeenCalledTimes(1);
		expect(f.bridge.captureReply).toHaveBeenLastCalledWith(
			expect.objectContaining({ success: false }),
		);
		f.capture.dispose();
	});
	it("flushes each hourly segment before the next and drains writes before stop", async () => {
		vi.useFakeTimers();
		const f = setup();
		await f.capture.handle(request("start", "main"));
		await vi.advanceTimersByTimeAsync(3600000);
		expect(Recorder.all).toHaveLength(2);
		await f.capture.handle(request("stop", "main"));
		expect(f.bridge.writeChunk).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ segment: 0 }),
		);
		expect(f.bridge.writeChunk).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ segment: 1 }),
		);
		expect(f.stream.track.stop).toHaveBeenCalledTimes(1);
		f.capture.dispose();
	});
	it("releases late permission results after cancellation without creating a recorder", async () => {
		const f = setup();
		let releasePermission: ((stream: AudioStream) => void) | undefined;
		f.media.getUserMedia.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releasePermission = resolve;
				}),
		);
		const starting = f.capture.handle(request("start", "main"));
		await f.capture.handle(request("cancel", "main"));
		releasePermission?.(f.stream);
		await starting;
		expect(Recorder.all).toHaveLength(0);
		expect(f.stream.track.stop).toHaveBeenCalledTimes(1);
		f.capture.dispose();
	});
	it("preserves standalone translation when a separate recording request fails", async () => {
		const f = setup();
		const close = vi.fn(async () => {});
		const node = {
			port: { onmessage: (_event: MessageEvent<unknown>) => {} },
			connect: vi.fn(),
		};
		vi.stubGlobal("MediaStream", AudioStream);
		vi.stubGlobal(
			"AudioContext",
			class {
				close = close;
				audioWorklet = { addModule: vi.fn(async () => {}) };
				createMediaStreamSource = () => ({ connect: vi.fn() });
				resume = async () => {};
				destination = {};
			},
		);
		vi.stubGlobal(
			"AudioWorkletNode",
			class {
				port = node.port;
				connect = node.connect;
			},
		);
		try {
			await f.capture.handle(request("translate", "translation"));
			f.media.getUserMedia.mockRejectedValueOnce(
				new Error("Unavailable selected microphone"),
			);
			await f.capture.handle(request("start", "main"));
			expect(f.bridge.captureReply).toHaveBeenLastCalledWith(
				expect.objectContaining({ success: false }),
			);
			expect(close).not.toHaveBeenCalled();
			expect(f.system.track.stop).not.toHaveBeenCalled();
			node.port.onmessage({
				data: new ArrayBuffer(8),
			} as MessageEvent<unknown>);
			await f.capture.handle(request("stopTranslation", "translation"));
			expect(f.bridge.pcm).toHaveBeenCalledOnce();
			expect(close).toHaveBeenCalledOnce();
			expect(f.system.track.stop).toHaveBeenCalledOnce();
		} finally {
			f.capture.dispose();
		}
	});
	it("releases translation resources when translation initialization fails", async () => {
		const f = setup();
		const close = vi.fn(async () => {});
		vi.stubGlobal("MediaStream", AudioStream);
		vi.stubGlobal(
			"AudioContext",
			class {
				close = close;
				audioWorklet = {
					addModule: vi.fn(async () => {
						throw new Error("Worklet unavailable");
					}),
				};
				createMediaStreamSource = () => ({ connect: vi.fn() });
			},
		);
		try {
			await f.capture.handle(request("translate", "translation"));
			expect(f.bridge.captureReply).toHaveBeenLastCalledWith(
				expect.objectContaining({ success: false }),
			);
			expect(close).toHaveBeenCalledOnce();
			expect(f.system.track.stop).toHaveBeenCalledOnce();
		} finally {
			f.capture.dispose();
		}
	});
});

for (const platform of ["darwin", "linux"] as const) {
	it(`${platform} acquires exact named loopback with all processing disabled`, async () => {
		const f = setup();
		const system = new AudioStream();
		const input: MediaDeviceInfo = {
			deviceId: "loopback",
			groupId: "virtual",
			kind: "audioinput",
			label: platform === "darwin" ? "BlackHole 2ch" : "Monitor of output",
			toJSON: () => ({}),
		};
		const media = { ...f.media, enumerateDevices: async () => [input] };
		media.getUserMedia
			.mockResolvedValueOnce(f.stream)
			.mockResolvedValueOnce(system);
		const capture = createMeetingCapture(f.bridge, media);
		await capture.handle(
			request("start", "platform", { systemAudio: true, platform }),
		);
		expect(media.getUserMedia).toHaveBeenLastCalledWith({
			audio: {
				deviceId: { exact: "loopback" },
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
			video: false,
		});
		expect(media.getDisplayMedia).not.toHaveBeenCalled();
		await capture.handle(request("cancel", "platform"));
		expect(f.stream.track.stop).toHaveBeenCalledOnce();
		expect(system.track.stop).toHaveBeenCalledOnce();
		capture.dispose();
		f.capture.dispose();
	});
	it(`${platform} missing named source or permission never falls back and releases the mic`, async () => {
		for (const missing of [true, false]) {
			const f = setup();
			const media = {
				...f.media,
				enumerateDevices: async () =>
					missing
						? []
						: [
								{
									deviceId: "loopback",
									kind: "audioinput",
									label: "BlackHole",
									groupId: "",
									toJSON: () => ({}),
								} satisfies MediaDeviceInfo,
							],
			};
			if (!missing)
				media.getUserMedia
					.mockResolvedValueOnce(f.stream)
					.mockRejectedValueOnce(
						new DOMException("private", "NotAllowedError"),
					);
			const capture = createMeetingCapture(f.bridge, media);
			await capture.handle(
				request("start", "absent", { systemAudio: true, platform }),
			);
			expect(f.stream.track.stop).toHaveBeenCalledOnce();
			expect(Recorder.all).toHaveLength(0);
			expect(f.bridge.captureReply).toHaveBeenLastCalledWith(
				expect.objectContaining({
					success: false,
					reason: "systemUnavailable",
				}),
			);
			expect(media.getDisplayMedia).not.toHaveBeenCalled();
			expect(media.getUserMedia).toHaveBeenCalledTimes(missing ? 1 : 2);
			capture.dispose();
			f.capture.dispose();
		}
	});
}
it("Windows loopback stops/removes video, fails empty audio, and cleans late cancelled acquisition", async () => {
	const f = setup();
	const video = new Track();
	const stream = new AudioStream();
	vi.spyOn(stream, "getVideoTracks").mockReturnValue([video]);
	f.media.getDisplayMedia.mockResolvedValueOnce(stream);
	await f.capture.handle(
		request("start", "win", { systemAudio: true, platform: "win32" }),
	);
	expect(f.media.getDisplayMedia).toHaveBeenCalledWith({
		audio: true,
		video: true,
	});
	expect(video.stop).toHaveBeenCalledOnce();
	await f.capture.handle(request("cancel", "win"));
	f.capture.dispose();
	const empty = setup();
	vi.spyOn(empty.system, "getAudioTracks").mockReturnValue([]);
	await empty.capture.handle(
		request("start", "empty", { systemAudio: true, platform: "win32" }),
	);
	expect(empty.stream.track.stop).toHaveBeenCalledOnce();
	expect(empty.system.track.stop).toHaveBeenCalledOnce();
	expect(empty.bridge.captureReply).toHaveBeenLastCalledWith(
		expect.objectContaining({ success: false, reason: "systemUnavailable" }),
	);
	empty.capture.dispose();
	const late = setup();
	let resolve: ((stream: AudioStream) => void) | undefined;
	late.media.getDisplayMedia.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const starting = late.capture.handle(
		request("start", "late", { systemAudio: true, platform: "win32" }),
	);
	await Promise.resolve();
	await late.capture.handle(request("cancel", "late"));
	resolve?.(late.system);
	await starting;
	expect(late.stream.track.stop).toHaveBeenCalledOnce();
	expect(late.system.track.stop).toHaveBeenCalledOnce();
	expect(Recorder.all).toHaveLength(0);
	late.capture.dispose();
});
it("meetings use the shared recovered identity instead of the old per-meeting setting", async () => {
	const f = setup();
	const capture = createMeetingCapture(f.bridge, {
		...f.media,
		enumerateDevices: async () => [
			{
				deviceId: "shared-new",
				groupId: "shared",
				label: "Desk",
				kind: "audioinput",
				toJSON: () => ({}),
			},
		],
	});
	await capture.handle(
		request("start", "shared", {
			microphone: { deviceId: "shared-old", groupId: "shared", label: "Desk" },
		}),
	);
	expect(f.media.getUserMedia).toHaveBeenCalledWith({
		audio: { deviceId: { exact: "shared-new" } },
		video: false,
	});
	capture.dispose();
	f.capture.dispose();
});

it("starts replacement mic/system recorders before stopping old ones and isolates side segment names", async () => {
	vi.useFakeTimers();
	const f = setup();
	try {
		await f.capture.handle(request("start", "main", { systemAudio: true }));
		await f.capture.handle(request("start", "side", { parentId: "main" }));
		for (const recorder of Recorder.all.slice(0, 4)) {
			const original = recorder.stop;
			recorder.stop = vi.fn(() => {
				expect(
					Recorder.all.filter((r) => r.state === "recording").length,
				).toBeGreaterThanOrEqual(5);
				original();
			});
		}
		await vi.advanceTimersByTimeAsync(3600000);
		expect(Recorder.all).toHaveLength(8);
		for (const recorder of Recorder.all) {
			expect(recorder.options.mimeType).toBe("audio/webm;codecs=opus");
			expect(recorder.start).toHaveBeenCalledWith(10000);
		}
		await f.capture.handle(request("stop", "side"));
		await f.capture.handle(request("stop", "main"));
		for (const id of ["main", "side"])
			for (const track of ["mic", "system"])
				for (const segment of [0, 1])
					expect(f.bridge.writeChunk).toHaveBeenCalledWith(
						expect.objectContaining({ id, track, segment }),
					);
	} finally {
		f.capture.dispose();
		vi.useRealTimers();
	}
});

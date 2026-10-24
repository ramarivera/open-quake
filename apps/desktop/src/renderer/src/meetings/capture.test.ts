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
	getVideoTracks = () => [];
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
});

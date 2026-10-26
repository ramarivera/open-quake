import { afterEach, expect, it, vi } from "vitest";
import { captureThemeThumbnail } from "./capture-thumbnail";

function fixture() {
	const listeners = new Map<string, () => void>();
	const video = {
		currentTime: 0,
		duration: 5,
		readyState: 0,
		videoWidth: 960,
		videoHeight: 240,
		muted: false,
		preload: "",
		src: "",
		pause: vi.fn(),
		load: vi.fn(),
		removeAttribute: vi.fn(),
		addEventListener: (name: string, callback: () => void) =>
			listeners.set(name, callback),
		removeEventListener: (name: string) => listeners.delete(name),
	};
	const canvas = {
		width: 0,
		height: 0,
		getContext: (): { drawImage: typeof drawImage } | null => ({ drawImage }),
		toDataURL: vi.fn(() => "data:image/jpeg;base64,YQ=="),
	};
	const drawImage = vi.fn();
	vi.stubGlobal("document", {
		createElement: (tag: string) => (tag === "video" ? video : canvas),
	});
	return {
		video,
		canvas,
		drawImage,
		listeners,
		emit: (name: string) => listeners.get(name)?.(),
	};
}
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("waits for seek and decoded data, captures 960x240 JPEG at 0.72 and releases the video", async () => {
	vi.useFakeTimers();
	const f = fixture();
	const pending = captureThemeThumbnail("oq-clock-media://theme/season?r=1");
	expect(f.video.muted).toBe(true);
	f.emit("loadedmetadata");
	expect(f.video.currentTime).toBe(0.1);
	f.emit("seeked");
	expect(f.drawImage).not.toHaveBeenCalled();
	f.video.readyState = 2;
	f.emit("loadeddata");
	expect(await pending).toBe("data:image/jpeg;base64,YQ==");
	expect(f.drawImage).toHaveBeenCalledWith(f.video, 0, 0, 960, 240);
	expect(f.canvas.toDataURL).toHaveBeenCalledWith("image/jpeg", 0.72);
	expect(f.listeners.size).toBe(0);
	expect(f.video.pause).toHaveBeenCalledOnce();
	expect(f.video.removeAttribute).toHaveBeenCalledWith("src");
	expect(vi.getTimerCount()).toBe(0);
});
it.each(["timeout", "abort", "error"])(
	"cleans up a %s without drawing a blank frame",
	async (reason) => {
		vi.useFakeTimers();
		const f = fixture();
		const controller = new AbortController();
		const pending = captureThemeThumbnail("opaque-video", controller.signal);
		f.emit("loadedmetadata");
		if (reason === "timeout") await vi.advanceTimersByTimeAsync(4000);
		else if (reason === "abort") controller.abort();
		else f.emit("error");
		expect(await pending).toBeNull();
		expect(f.drawImage).not.toHaveBeenCalled();
		expect(f.listeners.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	},
);
it("seeks very short metadata to half-duration and handles a missing canvas context", async () => {
	const f = fixture();
	f.video.duration = 0.1;
	vi.spyOn(f.canvas, "getContext").mockReturnValue(null);
	const pending = captureThemeThumbnail("short");
	f.emit("loadedmetadata");
	expect(f.video.currentTime).toBe(0.05);
	f.video.readyState = 2;
	f.emit("seeked");
	expect(await pending).toBeNull();
});

it("discovers a streaming WebM duration before seeking the decoded thumbnail frame", async () => {
	const f = fixture();
	f.video.duration = Number.POSITIVE_INFINITY;
	const pending = captureThemeThumbnail("streaming.webm");
	f.emit("loadedmetadata");
	expect(f.video.currentTime).toBe(Number.MAX_SAFE_INTEGER);
	f.video.readyState = 2;
	f.emit("seeked");
	expect(f.drawImage).not.toHaveBeenCalled();
	f.video.duration = 3;
	f.emit("durationchange");
	expect(f.video.currentTime).toBe(0.1);
	f.emit("seeked");
	expect(await pending).toBe("data:image/jpeg;base64,YQ==");
});

// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import {
	stableThumbnailFrame,
	thumbnailCaptureMode,
	thumbnailDeadline,
	thumbnailInitialSweep,
	waitForThumbnailMedia,
} from "./thumbnail-capture";

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("SCREEN-098 chooses background capture and explicit Linux startup policy", () => {
	for (const platform of ["darwin", "win32"] as const) {
		expect(thumbnailCaptureMode(platform)).toBe("hidden");
		expect(thumbnailInitialSweep(platform)).toBe(true);
		expect(thumbnailInitialSweep(platform, "off")).toBe(false);
	}
	expect(thumbnailCaptureMode("linux")).toBe("offscreen");
	expect(thumbnailCaptureMode("linux", "off")).toBe("unsupported");
	expect(thumbnailInitialSweep("linux")).toBe(false);
	expect(thumbnailInitialSweep("linux", "on")).toBe(true);
});
it("SCREEN-098 requires adjacent equal frames and stops after six changing frames", async () => {
	const frames = ["a", "b", "b"].map((value) => Buffer.from(value));
	const capture = vi.fn(
		async () => frames.shift() ?? Buffer.from("unexpected"),
	);
	const next = vi.fn(async () => {});
	expect(
		await stableThumbnailFrame(capture, next, new AbortController().signal),
	).toEqual(Buffer.from("b"));
	expect(capture).toHaveBeenCalledTimes(3);
	expect(next).toHaveBeenCalledTimes(2);
	let frame = 0;
	const unstable = vi.fn(async () => Buffer.from(String(frame++)));
	await expect(
		stableThumbnailFrame(unstable, next, new AbortController().signal),
	).rejects.toBeInstanceOf(ProfileThumbnailFailed);
	expect(unstable).toHaveBeenCalledTimes(6);
});
it("SCREEN-098 closes timed-out or cancelled capture owners without publishing late data", async () => {
	vi.useFakeTimers();
	const cancel = vi.fn();
	const controller = new AbortController();
	const pending = thumbnailDeadline(
		() => new Promise<string>(() => {}),
		8000,
		controller.signal,
		cancel,
	);
	const timeout = expect(pending).rejects.toMatchObject({
		_tag: "ProfileThumbnailFailed",
		code: "QUAKE.PROFILE.THUMBNAIL_FAILED",
	});
	await vi.advanceTimersByTimeAsync(8000);
	await timeout;
	expect(cancel).toHaveBeenCalledTimes(1);
	const stopped = thumbnailDeadline(
		() => new Promise<string>(() => {}),
		8000,
		controller.signal,
		cancel,
	);
	const aborted = expect(stopped).rejects.toBeInstanceOf(
		ProfileThumbnailFailed,
	);
	controller.abort();
	await aborted;
	expect(cancel).toHaveBeenCalledTimes(2);
	expect(vi.getTimerCount()).toBe(0);
});
it("SCREEN-098 waits for fonts, decoded images and a video frame before settling", async () => {
	const preview = document.createElement("div");
	preview.dataset.profileReady = "p";
	const image = document.createElement("img"),
		video = document.createElement("video");
	preview.append(image, video);
	document.body.append(preview);
	let fontsReady = () => {},
		imageReady = () => {};
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: {
			ready: new Promise<void>((resolve) => {
				fontsReady = resolve;
			}),
		},
	});
	Object.defineProperties(image, {
		complete: { value: true },
		naturalWidth: { value: 10 },
		naturalHeight: { value: 5 },
		decode: {
			value: vi
				.fn()
				.mockImplementationOnce(
					() =>
						new Promise<void>((resolve) => {
							imageReady = resolve;
						}),
				)
				.mockResolvedValue(undefined),
		},
	});
	Object.defineProperties(video, {
		readyState: { configurable: true, value: 0 },
		videoWidth: { value: 10 },
	});
	mockImageSnapshot();
	const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
	const freeze = vi.fn();
	Object.defineProperty(preview, "getAnimations", {
		value: () => [{ pause: freeze }],
	});
	const frame = vi.fn((callback: FrameRequestCallback) => {
		callback(0);
		return 0;
	});
	vi.stubGlobal("requestAnimationFrame", frame);
	let ready = false;
	const waiting = waitForThumbnailMedia().then(() => {
		ready = true;
	});
	await Promise.resolve();
	expect(ready).toBe(false);
	fontsReady();
	await Promise.resolve();
	imageReady();
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	expect(ready).toBe(false);
	Object.defineProperty(video, "readyState", { value: 2 });
	video.dispatchEvent(new Event("loadeddata"));
	await waiting;
	expect(frame).toHaveBeenCalledTimes(2);
	expect(pause).toHaveBeenCalledOnce();
	expect(freeze).toHaveBeenCalledOnce();
});

function mockImageSnapshot() {
	const drawImage = vi.fn();
	const context = { drawImage } as unknown as CanvasRenderingContext2D;
	const getContext = vi
		.spyOn(HTMLCanvasElement.prototype, "getContext")
		.mockReturnValue(context);
	const encode = vi
		.spyOn(HTMLCanvasElement.prototype, "toDataURL")
		.mockReturnValue("data:image/png;base64,frozen");
	return { drawImage, getContext, encode };
}
function decodedImage(source: string) {
	const image = document.createElement("img");
	image.src = source;
	Object.defineProperties(image, {
		complete: { value: true },
		naturalWidth: { value: 20 },
		naturalHeight: { value: 10 },
		decode: { value: vi.fn().mockResolvedValue(undefined) },
	});
	return image;
}
function imagePreview() {
	const preview = document.createElement("div");
	preview.dataset.profileReady = "animated";
	document.body.append(preview);
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: { ready: Promise.resolve() },
	});
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		callback(0);
		return 0;
	});
	return preview;
}
it("SCREEN-098 freezes decoded GIF pixels before requiring equal frames and keeps image presentation", async () => {
	const preview = imagePreview();
	const picture = document.createElement("picture");
	const source = document.createElement("source");
	source.srcset = "data:image/gif;base64,animated 2x";
	const image = decodedImage("data:image/gif;base64,animated");
	image.srcset = "data:image/gif;base64,animated 1x";
	image.alt = "Animated artwork";
	image.draggable = false;
	image.className = "strip-artwork";
	image.style.cssText =
		"width: 80px; height: 40px; object-fit: contain; object-position: right bottom;";
	const style = image.getAttribute("style");
	picture.append(source, image);
	preview.append(picture);
	const outside = decodedImage(image.src);
	document.body.append(outside);
	const { drawImage, encode } = mockImageSnapshot();
	let frame = 0;
	const capture = vi.fn(async () =>
		Buffer.from(
			image.src.startsWith("data:image/png;") ? "frozen" : String(frame++),
		),
	);
	await expect(
		stableThumbnailFrame(capture, async () => {}, new AbortController().signal),
	).rejects.toBeInstanceOf(ProfileThumbnailFailed);
	capture.mockClear();
	await waitForThumbnailMedia();
	await expect(
		stableThumbnailFrame(capture, async () => {}, new AbortController().signal),
	).resolves.toEqual(Buffer.from("frozen"));
	expect(capture).toHaveBeenCalledTimes(2);
	expect(drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0);
	expect(encode).toHaveBeenCalledExactlyOnceWith("image/png");
	const canvas = encode.mock.instances[0];
	expect(canvas).toMatchObject({ width: 20, height: 10 });
	expect(picture.querySelector("img")).toBe(image);
	expect(image).toMatchObject({
		alt: "Animated artwork",
		draggable: false,
		className: "strip-artwork",
	});
	expect(image.getAttribute("style")).toBe(style);
	expect(image.hasAttribute("srcset")).toBe(false);
	expect(source.hasAttribute("srcset")).toBe(false);
	expect(image.decode).toHaveBeenCalledTimes(2);
	expect(outside.src).toBe("data:image/gif;base64,animated");
	expect(outside.decode).not.toHaveBeenCalled();
});
it.each(["context", "draw", "readback", "empty", "decode"])(
	"SCREEN-098 fails closed when image freezing fails at %s",
	async (failure) => {
		const preview = imagePreview();
		const image = decodedImage("data:image/gif;base64,animated");
		preview.append(image);
		const { getContext, drawImage, encode } = mockImageSnapshot();
		const cause = new DOMException(
			"Unreadable thumbnail image",
			"SecurityError",
		);
		if (failure === "context") getContext.mockReturnValue(null);
		if (failure === "draw")
			drawImage.mockImplementation(() => {
				throw cause;
			});
		if (failure === "empty") encode.mockReturnValue("data:,");
		if (failure === "readback")
			encode.mockImplementation(() => {
				throw cause;
			});
		if (failure === "decode")
			vi.mocked(image.decode)
				.mockResolvedValueOnce(undefined)
				.mockRejectedValueOnce(cause);
		await expect(waitForThumbnailMedia()).rejects.toBeInstanceOf(Error);
		if (failure !== "decode")
			expect(image.src).toBe("data:image/gif;base64,animated");
	},
);

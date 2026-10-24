/** DK-Suite gives the duration probe 6 s (`ClockBackgroundCards.vue`). */
export const VIDEO_PROBE_TIMEOUT_MS = 6000;

type ProbeEvent = "loadedmetadata" | "durationchange" | "error";
export interface ProbeTarget {
	preload: string;
	muted: boolean;
	src: string;
	currentTime: number;
	readonly duration: number;
	addEventListener(type: ProbeEvent, listener: () => void): void;
	removeEventListener(type: ProbeEvent, listener: () => void): void;
	removeAttribute(name: "src"): void;
	load(): void;
}

/**
 * Reads a video's duration in milliseconds from its metadata, or null when it
 * errors or takes longer than the timeout. Streams written without a duration
 * (MediaRecorder WebM reports Infinity) are seeked to the end so the browser
 * computes it. The element is released afterwards.
 */
export function probeVideoDuration(
	url: string,
	create: () => ProbeTarget = () => document.createElement("video"),
	timeoutMs = VIDEO_PROBE_TIMEOUT_MS,
	timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
): Promise<number | null> {
	return new Promise((resolve) => {
		const video = create();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (value: number | null): void => {
			timers.clearTimeout(timer);
			video.removeEventListener("loadedmetadata", onMeta);
			video.removeEventListener("durationchange", onMeta);
			video.removeEventListener("error", onError);
			video.removeAttribute("src");
			video.load();
			resolve(value);
		};
		let seeked = false;
		const onMeta = (): void => {
			if (Number.isFinite(video.duration) && video.duration > 0)
				finish(video.duration * 1000);
			else if (video.duration === Number.POSITIVE_INFINITY && !seeked) {
				seeked = true;
				video.currentTime = Number.MAX_SAFE_INTEGER;
			}
		};
		const onError = (): void => finish(null);
		video.addEventListener("loadedmetadata", onMeta);
		video.addEventListener("durationchange", onMeta);
		video.addEventListener("error", onError);
		timer = timers.setTimeout(() => finish(null), timeoutMs);
		video.preload = "metadata";
		video.muted = true;
		video.src = url;
	});
}

/** Decode one muted frame. Metadata alone is insufficient for drawing a thumbnail. */
export function captureThemeThumbnail(
	url: string,
	signal?: AbortSignal,
): Promise<string | null> {
	return new Promise((resolve) => {
		const video = document.createElement("video");
		let done = false;
		let sought = false;
		let awaitingDuration = false;
		const finish = (value: string | null) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			video.removeEventListener("loadedmetadata", metadata);
			video.removeEventListener("durationchange", durationChanged);
			video.removeEventListener("loadeddata", decoded);
			video.removeEventListener("seeked", seeked);
			video.removeEventListener("error", failed);
			video.pause();
			video.removeAttribute("src");
			video.load();
			resolve(value);
		};
		const abort = () => finish(null);
		const failed = () => finish(null);
		const draw = () => {
			if (
				done ||
				!sought ||
				video.readyState < 2 ||
				!video.videoWidth ||
				!video.videoHeight
			)
				return;
			try {
				const canvas = document.createElement("canvas");
				canvas.width = 960;
				canvas.height = 240;
				const context = canvas.getContext("2d");
				if (!context) return finish(null);
				context.drawImage(video, 0, 0, 960, 240);
				const jpeg = canvas.toDataURL("image/jpeg", 0.72);
				finish(jpeg.startsWith("data:image/jpeg;") ? jpeg : null);
			} catch {
				finish(null);
			}
		};
		const decoded = () => {
			if (done || awaitingDuration || !sought || video.readyState < 2) return;
			draw();
		};
		const seeked = () => {
			sought = true;
			decoded();
		};
		const metadata = () => {
			if (video.duration === Number.POSITIVE_INFINITY) {
				awaitingDuration = true;
				video.currentTime = Number.MAX_SAFE_INTEGER;
				return;
			}
			if (!Number.isFinite(video.duration) || video.duration <= 0)
				return finish(null);
			awaitingDuration = false;
			sought = false;
			video.currentTime = Math.min(0.1, video.duration / 2);
		};
		const durationChanged = () => {
			if (awaitingDuration && Number.isFinite(video.duration)) metadata();
		};
		const timer = setTimeout(failed, 4000);
		video.muted = true;
		video.crossOrigin = "anonymous";
		video.preload = "auto";
		video.addEventListener("loadedmetadata", metadata);
		video.addEventListener("durationchange", durationChanged);
		video.addEventListener("loadeddata", decoded);
		video.addEventListener("seeked", seeked);
		video.addEventListener("error", failed);
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) return abort();
		video.src = url;
		video.load();
	});
}

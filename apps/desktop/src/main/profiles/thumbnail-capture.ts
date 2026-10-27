import { ProfileThumbnailFailed } from "../../../../../packages/device/src/profiles/profile-errors.js";
import type { ProfilePlatform } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";

export const thumbnailCaptureMode = (
	platform: ProfilePlatform,
	linuxMode?: string,
): "hidden" | "offscreen" | "unsupported" =>
	platform !== "linux"
		? "hidden"
		: linuxMode === "off"
			? "unsupported"
			: "offscreen";
export const thumbnailInitialSweep = (
	platform: ProfilePlatform,
	value?: string,
): boolean => value === "on" || (value !== "off" && platform !== "linux");

/** Cancels the owning window as well as rejecting a stalled Electron call. */
export async function thumbnailDeadline<A>(
	operation: () => Promise<A>,
	milliseconds: number,
	signal: AbortSignal,
	cancel: () => void,
): Promise<A> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort: (() => void) | undefined;
	try {
		signal.throwIfAborted();
		return await Promise.race([
			operation(),
			new Promise<never>((_resolve, reject) => {
				abort = () => {
					cancel();
					reject(ProfileThumbnailFailed.fromCause(signal.reason));
				};
				signal.addEventListener("abort", abort, { once: true });
				timer = setTimeout(() => {
					cancel();
					reject(
						ProfileThumbnailFailed.fromCause(
							new Error("Thumbnail stage timed out"),
						),
					);
				}, milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (abort) signal.removeEventListener("abort", abort);
	}
}

/** Two matching adjacent frames, at most six capture rounds. */
export async function stableThumbnailFrame(
	capture: () => Promise<Buffer>,
	nextFrame: () => Promise<void>,
	signal: AbortSignal,
): Promise<Buffer> {
	let previous: Buffer | undefined;
	for (let round = 0; round < 6; round++) {
		signal.throwIfAborted();
		const frame = await capture();
		signal.throwIfAborted();
		if (previous?.equals(frame)) return frame;
		previous = frame;
		if (round < 5) await nextFrame();
	}
	throw ProfileThumbnailFailed.fromCause(
		new Error("Thumbnail frames did not settle"),
	);
}

/** Serialized into the isolated preview. It never reads host state or opens media. */
export async function waitForThumbnailMedia(): Promise<void> {
	const preview = document.querySelector("[data-profile-ready]");
	if (!preview) throw new Error("Missing profile preview");
	await document.fonts.ready;
	await Promise.all(
		Array.from(preview.querySelectorAll("img")).map(async (image) => {
			await image.decode();
			if (
				!image.complete ||
				image.naturalWidth === 0 ||
				image.naturalHeight === 0
			)
				throw new Error("Thumbnail image unavailable");
			// Keep the same element so tile CSS, object-fit, refs and accessibility
			// survive. Canvas reads already-decoded pixels, including animated images,
			// without fetching media. Tainted/unreadable pixels must reject capture.
			const snapshot = document.createElement("canvas");
			snapshot.width = image.naturalWidth;
			snapshot.height = image.naturalHeight;
			const context = snapshot.getContext("2d");
			if (!context) throw new Error("Thumbnail image snapshot unavailable");
			context.drawImage(image, 0, 0);
			const source = snapshot.toDataURL("image/png");
			if (!source.startsWith("data:image/png;"))
				throw new Error("Thumbnail image snapshot unavailable");
			image.removeAttribute("srcset");
			if (image.parentElement?.tagName === "PICTURE")
				for (const candidate of image.parentElement.querySelectorAll("source"))
					candidate.removeAttribute("srcset");
			image.src = source;
			await image.decode();
		}),
	);
	await Promise.all(
		Array.from(preview.querySelectorAll("video")).map(
			(video) =>
				new Promise<void>((resolve, reject) => {
					if (video.readyState >= 2 && video.videoWidth > 0) {
						resolve();
						return;
					}
					const cleanup = () => {
						video.removeEventListener("loadeddata", ready);
						video.removeEventListener("error", failed);
					};
					const ready = () => {
						cleanup();
						if (video.videoWidth > 0) resolve();
						else reject(new Error("Thumbnail video has no frame"));
					};
					const failed = () => {
						cleanup();
						reject(new Error("Thumbnail video unavailable"));
					};
					video.addEventListener("loadeddata", ready, { once: true });
					video.addEventListener("error", failed, { once: true });
				}),
		),
	);
	// These nodes belong only to the hidden capture, so freeze moving media at
	// its first decoded frame before checking pixel stability.
	for (const video of preview.querySelectorAll("video")) video.pause();
	for (const animation of preview.getAnimations?.({ subtree: true }) ?? [])
		animation.pause();
	await new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
	);
}

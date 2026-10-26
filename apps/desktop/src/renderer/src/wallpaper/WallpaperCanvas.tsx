import { useEffect, useMemo, useRef } from "react";
import { fillGeometry, PANEL_CANVAS } from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import "./wallpaper.css";

/**
 * The saved wallpaper on the logical 1920 × 480 canvas. The strip draws it
 * only for the vivid screen page; the clock is the dkDesktopClock tile's job.
 */
export function WallpaperCanvas({
	snapshot,
	sound = false,
}: {
	snapshot?: WallpaperSnapshot | undefined;
	sound?: boolean;
}): React.JSX.Element {
	const asset = snapshot?.asset;
	const media =
		snapshot?.saved.settings.displayMediaList[snapshot?.activeIndex ?? 0];
	const video = useRef<HTMLVideoElement>(null);
	const videoUrl =
		asset?._tag === "ready" && media?.type === "video"
			? asset.dataUrl
			: undefined;
	const playback = useMemo(
		() => ({ url: videoUrl, id: snapshot?.playbackId }),
		[videoUrl, snapshot?.playbackId],
	);
	const playbackKey = JSON.stringify([
		snapshot?.saved.serial,
		playback.id,
		playback.url,
	]);
	useEffect(() => {
		const element = video.current;
		if (!element || !playback.url) return;
		void element.play().catch(() => undefined);
		return () => {
			element.pause();
			element.removeAttribute("src");
			element.load();
		};
	}, [playback]);
	const serial = snapshot?.saved.serial;
	const revision = snapshot?.saved.revision;
	const enableSound = sound && snapshot?.saved.settings.enableSound;
	useEffect(() => {
		if (!playback.url || !serial || revision === undefined || !enableSound)
			return;
		const id = `${playback.id ?? 0}:${crypto.randomUUID()}`;
		void window.quakeWallpaper?.audio?.({ id, active: true, serial, revision });
		return () => {
			void window.quakeWallpaper?.audio?.({
				id,
				active: false,
				serial,
				revision,
			});
		};
	}, [playback, serial, revision, enableSound]);
	const geometry =
		asset?._tag === "ready"
			? fillGeometry(
					snapshot?.saved.settings.bgFillMode ?? "cover",
					asset.width,
					asset.height,
				)
			: undefined;
	return (
		<svg
			className="wallpaper-canvas"
			viewBox={`0 0 ${PANEL_CANVAS.width} ${PANEL_CANVAS.height}`}
			role="img"
			aria-label="Wallpaper"
			data-revision={snapshot?.saved.revision}
		>
			<title>Wallpaper</title>
			<rect width="1920" height="480" className="wallpaper-neutral" />
			{asset?._tag === "ready" && geometry ? (
				media?.type === "video" ? (
					<foreignObject x="0" y="0" width="1920" height="480">
						<video
							key={playbackKey}
							ref={video}
							src={videoUrl}
							autoPlay
							playsInline
							muted={!sound || !snapshot?.saved.settings.enableSound}
							loop={snapshot?.saved.settings.displayMediaList.length === 1}
							style={{
								width: "1920px",
								height: "480px",
								objectFit:
									snapshot?.saved.settings.bgFillMode === "center"
										? "none"
										: snapshot?.saved.settings.bgFillMode,
							}}
						/>
					</foreignObject>
				) : (
					<image href={asset.dataUrl} {...geometry} preserveAspectRatio="none">
						<title>{media?.name ?? "Wallpaper"}</title>
					</image>
				)
			) : null}
		</svg>
	);
}

import { fillGeometry, PANEL_CANVAS } from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import "./wallpaper.css";

/**
 * The saved wallpaper on the logical 1920 × 480 canvas. The strip draws it
 * only for the vivid screen page; the clock is the dkDesktopClock tile's job.
 */
export function WallpaperCanvas({
	snapshot,
}: {
	snapshot?: WallpaperSnapshot | undefined;
}): React.JSX.Element {
	const asset = snapshot?.asset;
	const media = snapshot?.saved.settings.displayMediaList[0];
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
				<image href={asset.dataUrl} {...geometry} preserveAspectRatio="none">
					<title>{media?.name ?? "Wallpaper"}</title>
				</image>
			) : null}
		</svg>
	);
}

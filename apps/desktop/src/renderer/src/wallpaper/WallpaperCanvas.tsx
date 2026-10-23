import {
	displayTileRegistry,
	fillGeometry,
	formatClock,
	PANEL_CANVAS,
} from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import "./wallpaper.css";

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
	const clock =
		snapshot?.saved.clock ?? displayTileRegistry.dkDesktopClock.defaults;
	return (
		<svg
			className="wallpaper-canvas"
			viewBox={`0 0 ${PANEL_CANVAS.width} ${PANEL_CANVAS.height}`}
			role="img"
			aria-label="Wallpaper and desktop clock"
			data-revision={snapshot?.saved.revision}
		>
			<title>Wallpaper and desktop clock</title>
			<rect width="1920" height="480" className="wallpaper-neutral" />
			{asset?._tag === "ready" && geometry ? (
				<image href={asset.dataUrl} {...geometry} preserveAspectRatio="none">
					<title>{media?.name ?? "Wallpaper"}</title>
				</image>
			) : null}
			<rect
				x="48"
				y="272"
				width="780"
				height="160"
				rx="12"
				className="wallpaper-clock-backing"
			/>
			<text x="80" y="310" className="wallpaper-clock-label">
				LOCAL TIME
			</text>
			<text x="80" y="397" className="wallpaper-clock" data-tile={clock.type}>
				{snapshot
					? formatClock(snapshot.clock, clock.actions[0].value)
					: "--:--:--"}
			</text>
		</svg>
	);
}

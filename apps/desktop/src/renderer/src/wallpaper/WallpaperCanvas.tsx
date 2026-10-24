import { useId } from "react";
import {
	displayTileRegistry,
	fillGeometry,
	formatClock,
	PANEL_CANVAS,
} from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import "./wallpaper.css";

/**
 * Hours and minutes end at `x`; seconds and AM/PM stack to its right. Tabular
 * figures keep that edge fixed, so nothing shifts as the time changes.
 */
const CLOCK = { x: 860, baseline: 352, secondsBaseline: 226, gap: 28 } as const;

export function WallpaperCanvas({
	snapshot,
	children,
}: {
	snapshot?: WallpaperSnapshot | undefined;
	/** Panel-only layers drawn above the clock in canvas coordinates. */
	children?: React.ReactNode;
}): React.JSX.Element {
	const scrim = `wallpaper-scrim-${useId().replace(/[^\w-]/g, "")}`;
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
	const time = snapshot
		? formatClock(snapshot.clock, clock.actions[0].value)
		: "--:--:--";
	const [hms = "", meridiem] = time.split(" ");
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
				<>
					<image href={asset.dataUrl} {...geometry} preserveAspectRatio="none">
						<title>{media?.name ?? "Wallpaper"}</title>
					</image>
					{/* Keeps the clock legible over any image without boxing it in. */}
					<linearGradient id={scrim} className="wallpaper-scrim">
						<stop offset="0" stopOpacity="0.85" />
						<stop offset="0.45" stopOpacity="0.7" />
						<stop offset="0.6" stopOpacity="0.4" />
						<stop offset="0.78" stopOpacity="0" />
					</linearGradient>
					<rect width="1920" height="480" fill={`url(#${scrim})`} />
				</>
			) : null}
			<g className="wallpaper-clock-group" data-time={time}>
				<text
					x={CLOCK.x}
					y={CLOCK.baseline}
					className="wallpaper-clock"
					data-tile={clock.type}
				>
					{hms.slice(0, 5)}
				</text>
				<text
					x={CLOCK.x + CLOCK.gap}
					y={CLOCK.secondsBaseline}
					className="wallpaper-clock-seconds"
				>
					{hms.slice(6)}
				</text>
				{meridiem ? (
					<text
						x={CLOCK.x + CLOCK.gap}
						y={CLOCK.baseline}
						className="wallpaper-clock-meridiem"
					>
						{meridiem}
					</text>
				) : null}
			</g>
			{children}
		</svg>
	);
}

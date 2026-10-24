import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { WallpaperCanvas } from "../wallpaper/WallpaperCanvas";
import "./css-properties";
import { STRIP_CANVAS, type StripLayout, stripLayout } from "./geometry";
import { stripPaletteProperties } from "./palette";
import { selectStripPage } from "./selection";
import { stripTileFor } from "./tileRegistry";
import type { StripProfiles } from "./useStripProfiles";
import "./strip.css";

const palette = stripPaletteProperties();

function StripGrid({
	layout,
	pressedKeyCode,
	now,
	hourFormat,
}: {
	layout: StripLayout;
	pressedKeyCode: string | undefined;
	now: Date | undefined;
	hourFormat: "24h" | "12h";
}): React.JSX.Element {
	return (
		<div className="strip-grid" data-theme={layout.theme.name}>
			{layout.cells.map((cell) => (
				<div
					key={cell.keyCode}
					className="strip-slot"
					data-key-code={cell.keyCode}
					data-state={cell.state}
					style={{
						left: cell.rect.x,
						top: cell.rect.y,
						width: cell.rect.width,
						height: cell.rect.height,
						borderRadius: layout.theme.borderRadius,
					}}
				/>
			))}
			{layout.tiles.map((tile) => {
				const Tile = stripTileFor(tile.type);
				return (
					<div
						key={tile.keyCode}
						className="strip-slot"
						data-key-code={tile.keyCode}
						data-state="tile"
						data-pressed={
							pressedKeyCode === tile.keyCode && tile.pressFeedback
								? "true"
								: undefined
						}
						data-press-scale={tile.pressScale ? "true" : undefined}
						style={{
							left: tile.slot.x,
							top: tile.slot.y,
							width: tile.slot.width,
							height: tile.slot.height,
							borderRadius: tile.slotRadius,
							zIndex: tile.zIndex || undefined,
						}}
					>
						<Tile tile={tile} context={{ now, hourFormat }} />
					</div>
				);
			})}
		</div>
	);
}

/**
 * The QUAKE strip on its fixed 1920×480 canvas: the wallpaper underneath, the
 * opaque key grid above it, then panel overlays (strip-key-grid "Strip canvas
 * and layer stack"). The panel window and the management preview both render
 * this component.
 */
export function StripScreen({
	profiles,
	wallpaper,
	view = "active",
	showEmptyGridDashedBorder,
	pressedKeyCode,
	children,
}: {
	profiles: StripProfiles;
	wallpaper?: WallpaperSnapshot | undefined;
	/** "vivid" previews the wallpaper the vivid screen page shows. */
	view?: "active" | "vivid";
	showEmptyGridDashedBorder: boolean;
	pressedKeyCode?: string | undefined;
	/** Overlays in canvas coordinates, drawn above the grid. */
	children?: React.ReactNode;
}): React.JSX.Element {
	const serial = wallpaper?.saved.serial;
	const layout = useMemo(() => {
		if (profiles._tag !== "ready") return undefined;
		const { profile, page } = selectStripPage(profiles.envelope, serial);
		return stripLayout(profile, page);
	}, [profiles, serial]);
	const vivid = view === "vivid" || (layout?.vivid ?? false);
	const now = wallpaper ? new Date(wallpaper.clock.epochMillis) : undefined;
	const hourFormat = wallpaper?.saved.clock.actions[0].value ?? "24h";
	return (
		<div
			className="strip-screen"
			data-vivid={vivid}
			data-dashed={showEmptyGridDashedBorder}
			data-profiles={profiles._tag}
			style={{ ...palette, ...STRIP_CANVAS }}
		>
			{vivid && wallpaper?.asset._tag === "ready" ? (
				<div className="strip-wallpaper">
					<WallpaperCanvas snapshot={wallpaper} />
				</div>
			) : null}
			{!vivid && layout ? (
				<StripGrid
					layout={layout}
					pressedKeyCode={pressedKeyCode}
					now={now}
					hourFormat={hourFormat}
				/>
			) : null}
			{profiles._tag === "failure" && view === "active" ? (
				<div className="strip-status" role="status">
					<p className="strip-status-title">Profiles unavailable</p>
					<p className="strip-status-code">{profiles.code}</p>
				</div>
			) : null}
			{children ? (
				<svg
					className="strip-overlay"
					viewBox={`0 0 ${STRIP_CANVAS.width} ${STRIP_CANVAS.height}`}
				>
					<title>Panel controls</title>
					{children}
				</svg>
			) : null}
		</div>
	);
}

/** Scales the fixed canvas to fit its container, preserving 4:1. */
export function StripViewport({
	children,
}: {
	children: React.ReactNode;
}): React.JSX.Element {
	const frame = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	useLayoutEffect(() => {
		const element = frame.current;
		if (!element) return;
		const update = (): void => {
			// Layout size, not the bounding box: the panel window may rotate #root.
			const { clientWidth: width, clientHeight: height } = element;
			if (width > 0 && height > 0)
				setScale(
					Math.min(width / STRIP_CANVAS.width, height / STRIP_CANVAS.height),
				);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<div className="strip-viewport" ref={frame}>
			<div
				className="strip-viewport-stage"
				style={{
					width: STRIP_CANVAS.width,
					height: STRIP_CANVAS.height,
					transform: `translate(-50%, -50%) scale(${scale})`,
				}}
			>
				{children}
			</div>
		</div>
	);
}

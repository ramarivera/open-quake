import { useId } from "react";
import "../css-properties";
import { STRIP_PALETTE } from "../palette";
import {
	genericTileMetrics,
	isInlineIcon,
	rgbText,
	themeAccent,
} from "../tileMetrics";
import type { StripTileProps } from "../tileRegistry";
import { useIconAccent, useTruncatedTitle } from "../useTileArt";

/** commonBaseTheme unitCover: accent glow from the bottom edge and behind the icon. */
function AccentGlow({ id, accent }: { id: string; accent: string }) {
	return (
		<svg
			className="strip-tile-layer"
			viewBox="0 0 220 220"
			fill="none"
			aria-hidden="true"
		>
			<defs>
				<filter
					id={`${id}-bottom`}
					x="2"
					y="153"
					width="216"
					height="182"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feGaussianBlur stdDeviation="32" />
				</filter>
				<filter
					id={`${id}-icon`}
					x="2"
					y="21"
					width="216"
					height="216"
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
				>
					<feGaussianBlur stdDeviation="32" />
				</filter>
				<clipPath id={`${id}-clip`}>
					<rect width="220" height="220" rx="48" />
				</clipPath>
			</defs>
			<g clipPath={`url(#${id}-clip)`}>
				<g filter={`url(#${id}-bottom)`}>
					<ellipse cx="110" cy="244" rx="44" ry="27" fill={accent} />
				</g>
				<g opacity="0.6" filter={`url(#${id}-icon)`}>
					<circle cx="110" cy="129" r="44" fill={accent} />
				</g>
			</g>
		</svg>
	);
}

/** systemInfoTheme unitBg (1×1) and unitBg_2x1: a cyan glow along the bottom. */
function SystemInfoGlow({
	id,
	accent,
	wide,
}: {
	id: string;
	accent: string;
	wide: boolean;
}) {
	const [width, height] = wide ? [463, 221] : [220, 220];
	return (
		<svg
			className="strip-tile-layer"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			fill="none"
			aria-hidden="true"
		>
			<defs>
				<filter
					id={`${id}-bottom`}
					filterUnits="userSpaceOnUse"
					colorInterpolationFilters="sRGB"
					{...(wide
						? { x: -53.69, y: 80.31, width: 570.38, height: 334.38 }
						: { x: 2, y: 153, width: 216, height: 182 })}
				>
					<feGaussianBlur stdDeviation={wide ? 67.3455 : 32} />
				</filter>
				<clipPath id={`${id}-clip`}>
					<rect width={width} height={height} rx="48" />
				</clipPath>
			</defs>
			<g clipPath={`url(#${id}-clip)`}>
				<g opacity={wide ? 0.6 : 0.4} filter={`url(#${id}-bottom)`}>
					{wide ? (
						<ellipse cx="231.5" cy="247.5" rx="150.5" ry="32.5" fill={accent} />
					) : (
						<ellipse cx="110" cy="244" rx="44" ry="27" fill={accent} />
					)}
				</g>
			</g>
		</svg>
	);
}

/**
 * DK-Suite UnitControl's generic icon-and-title tile as the strip draws it.
 * See openspec/changes/strip-key-grid/design.md "Generic tile".
 */
export function GenericTile({ tile }: StripTileProps): React.JSX.Element {
	const id = `tile${useId().replace(/[^\w-]/g, "")}`;
	const { config } = tile.key;
	const metrics = genericTileMetrics(
		tile.box,
		tile.footprint,
		tile.cellTheme,
		config.title,
	);
	const accent = useIconAccent(
		config.icon,
		themeAccent(tile.cellTheme),
		metrics.layers === "commonBase",
	);
	const explicit = config.title.userModifiedStyle === true;
	const styles = config.title.style.split("|");
	const fontStyle = (explicit ? styles.includes("italic") : metrics.italic)
		? "italic"
		: "normal";
	const fontWeight = explicit
		? styles.includes("bold")
			? 900
			: 400
		: metrics.fontWeight;
	const fontSize = explicit
		? metrics.fontSize * (config.title.size / 8)
		: metrics.fontSize;
	const title = useTruncatedTitle(
		config.title.text,
		metrics.titleWidth,
		`${fontStyle} ${fontWeight} ${fontSize}px ${STRIP_PALETTE.font}`,
	);
	const accentRgb = `${accent.r}, ${accent.g}, ${accent.b}`;
	return (
		<div
			className="strip-tile"
			data-layers={metrics.layers}
			data-type={tile.type}
			style={{
				borderRadius: tile.tileRadius,
				"--strip-accent-rgb": accentRgb,
				"--strip-ring-75": metrics.ringFade[0],
				"--strip-ring-100": metrics.ringFade[1],
			}}
		>
			{metrics.layers === "commonBase" ? (
				<AccentGlow id={id} accent={rgbText(accent)} />
			) : metrics.layers === "systemInfo" ? (
				<div className="strip-tile-inset" style={{ inset: metrics.innerGap }}>
					<SystemInfoGlow
						id={id}
						accent={rgbText(accent)}
						wide={tile.footprint.width === 2 && tile.footprint.height === 1}
					/>
				</div>
			) : null}
			{metrics.layers !== "none" ? <div className="strip-tile-ring" /> : null}
			<div
				className="strip-tile-icon"
				style={{
					width: metrics.iconSize,
					height: metrics.iconSize,
					transform: `translateY(${metrics.iconShift}%)`,
				}}
			>
				{isInlineIcon(config.icon) ? (
					<img src={config.icon} alt="" draggable={false} />
				) : null}
			</div>
			{config.title.display ? (
				<p
					className="strip-tile-title"
					style={{
						fontSize,
						fontWeight,
						textDecoration:
							explicit && styles.includes("underline") ? "underline" : "none",
						fontStyle,
						color: config.title.color,
						width: tile.box.width,
						...(config.title.pos === "mid"
							? { top: "50%", transform: "translateY(-50%)", margin: 0 }
							: (
										explicit
											? config.title.pos === "top"
											: metrics.titleAnchor === "top"
									)
								? { top: `${metrics.titleOffset * 100}%` }
								: {
										// DK keeps the paragraph's 1em bottom margin.
										bottom: `calc(${metrics.titleOffset * 100}% + ${fontSize}px)`,
									}),
					}}
				>
					{title}
				</p>
			) : null}
		</div>
	);
}

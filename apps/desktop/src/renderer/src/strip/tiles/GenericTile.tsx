import { keyArtwork } from "../../keys/key-artwork";
import "../css-properties";
import { STRIP_PALETTE } from "../palette";
import { genericTileMetrics, isInlineIcon } from "../tileMetrics";
import type { StripTileProps } from "../tileRegistry";
import { useTruncatedTitle } from "../useTileArt";

/**
 * The flat icon-and-label key tile: the key's own artwork centred above a
 * bottom label. A user's explicit title style (colour, position, size, bold,
 * italic, underline) still wins. See independent-device-design.
 */
export function GenericTile({ tile }: StripTileProps): React.JSX.Element {
	const { config } = tile.key;
	const icon = keyArtwork(config.icon, config.type);
	const explicit = config.title.userModifiedStyle === true;
	const metrics = genericTileMetrics(tile.box, {
		pos: config.title.pos,
		style: config.title.style,
		userModifiedStyle: explicit,
	});
	const styles = config.title.style.split("|");
	const fontStyle = metrics.italic ? "italic" : "normal";
	const fontSize = explicit
		? Math.round(metrics.fontSize * (config.title.size / 8))
		: metrics.fontSize;
	const title = useTruncatedTitle(
		config.title.text,
		metrics.titleWidth,
		`${fontStyle} ${metrics.fontWeight} ${fontSize}px ${STRIP_PALETTE.font}`,
	);
	const placement =
		metrics.titleAnchor === "top"
			? { top: metrics.padding }
			: metrics.titleAnchor === "mid"
				? { top: "50%", transform: "translate(-50%, -50%)" }
				: { bottom: metrics.padding };
	return (
		<div
			className="strip-tile"
			data-type={tile.type}
			style={{ borderRadius: tile.tileRadius }}
		>
			<div
				className="strip-tile-icon"
				style={{
					width: metrics.iconSize,
					height: metrics.iconSize,
					top: `calc(${metrics.iconCenter * 100}% - ${metrics.iconSize / 2}px)`,
				}}
			>
				{isInlineIcon(icon) ? (
					<img src={icon} alt="" draggable={false} />
				) : null}
			</div>
			{config.title.display ? (
				<p
					className="strip-tile-title"
					style={{
						fontSize,
						fontWeight: metrics.fontWeight,
						fontStyle,
						textDecoration:
							explicit && styles.includes("underline") ? "underline" : "none",
						color: explicit ? config.title.color : undefined,
						width: metrics.titleWidth,
						...placement,
					}}
				>
					{title}
				</p>
			) : null}
		</div>
	);
}

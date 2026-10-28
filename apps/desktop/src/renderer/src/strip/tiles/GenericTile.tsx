import "../css-properties";
import { genericTileMetrics } from "../tileMetrics";
import type { StripTileProps } from "../tileRegistry";
import { useForegroundArtwork, useTileArtwork } from "../useTileArt";

/**
 * The flat icon-and-label key tile: the key's own artwork centred above a
 * bottom label. A user's explicit title style (colour, position, size, bold,
 * italic, underline) still wins. See independent-device-design.
 */
export function GenericTile({ tile }: StripTileProps): React.JSX.Element {
	const { config } = tile.key;
	const foreground = useForegroundArtwork(config.type === "gameMode");
	const artwork = useTileArtwork(foreground || config.icon, config.type);
	const explicit = config.title.userModifiedStyle === true;
	const metrics = genericTileMetrics(tile.box, {
		pos: config.title.pos,
		style: config.title.style,
		size: config.title.size,
		userModifiedStyle: explicit,
	});
	const styles = config.title.style.split("|");
	const fontStyle = metrics.italic ? "italic" : "normal";
	const fontSize = metrics.fontSize;
	const title = config.title.text;
	const placement =
		metrics.titleAnchor === "top"
			? { top: metrics.padding }
			: metrics.titleAnchor === "mid"
				? { top: "50%", transform: "translate(-50%, -50%)" }
				: { bottom: metrics.padding };
	const fullArtwork = config.type === "emoji" || config.type === "gameMode";
	const iconSize =
		config.type === "emoji"
			? Math.floor(Math.min(tile.box.width, tile.box.height) * 0.77)
			: metrics.iconSize;
	const iconWidth =
		config.type === "gameMode" ? Math.floor(tile.box.width * 0.95) : iconSize;
	const iconHeight =
		config.type === "gameMode" ? Math.floor(tile.box.height * 0.95) : iconSize;
	return (
		<div
			className="strip-tile"
			data-type={tile.type}
			style={{ borderRadius: tile.tileRadius }}
		>
			<div
				ref={artwork.ref}
				data-tile-artwork-state={artwork.state}
				className="strip-tile-icon"
				style={{
					width: iconWidth,
					height: iconHeight,
					top: `calc(${fullArtwork ? 50 : metrics.iconCenter * 100}% - ${iconHeight / 2}px)`,
				}}
			>
				{artwork.src ? (
					<img src={artwork.src} alt="" draggable={false} />
				) : null}
			</div>
			{config.title.display ? (
				<p
					className="strip-tile-title"
					data-full-title={title}
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

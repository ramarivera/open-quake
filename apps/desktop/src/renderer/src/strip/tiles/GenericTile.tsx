import "../css-properties";
import { luminancePercent } from "../../../../shared/hardware-contracts";
import { useLocaleText } from "../../i18n";
import { genericTileMetrics } from "../tileMetrics";
import type { StripTileProps } from "../tileRegistry";
import { useForegroundArtwork, useTileArtwork } from "../useTileArt";

/**
 * The flat icon-and-label key tile: the key's own artwork centred above a
 * bottom label. A user's explicit title style (colour, position, size, bold,
 * italic, underline) still wins. See independent-device-design.
 */
export function GenericTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const { config } = tile.key;
	const t = useLocaleText("picker");
	const luminance =
		config.type === "luminance" && context.hardware?.available
			? context.hardware.luminance
			: undefined;
	const hostPercent = context.runtimeState?.progress;
	const percent =
		config.type === "luminance"
			? luminance === undefined
				? undefined
				: luminancePercent(luminance)
			: config.type === "brightness" &&
					context.hardware?.available !== false &&
					hostPercent !== undefined &&
					Number.isFinite(hostPercent) &&
					hostPercent >= 0 &&
					hostPercent <= 100
				? Math.round(hostPercent)
				: undefined;
	const foreground = useForegroundArtwork(config.type === "gameMode");
	const artwork = useTileArtwork(foreground || config.icon, config.type);
	const explicit = config.title.userModifiedStyle === true;
	const brightness =
		["luminance", "brightness"].includes(config.type) && !explicit;
	const metrics = genericTileMetrics(tile.box, {
		pos: config.title.pos,
		style: config.title.style,
		size: config.title.size,
		userModifiedStyle: explicit,
	});
	const styles = config.title.style.split("|");
	const fontStyle = metrics.italic ? "italic" : "normal";
	const fontSize = brightness ? 18 : metrics.fontSize;
	const title = config.title.text;
	const placement = !explicit
		? brightness
			? { left: 68, top: 20, transform: "none", textAlign: "left" as const }
			: { left: 24, bottom: 22, transform: "none", textAlign: "left" as const }
		: metrics.titleAnchor === "top"
			? { top: metrics.padding }
			: metrics.titleAnchor === "mid"
				? { top: "50%", transform: "translate(-50%, -50%)" }
				: { bottom: metrics.padding };
	const fullArtwork = config.type === "emoji" || config.type === "gameMode";
	const titleAware = (explicit && config.title.display) || fullArtwork;
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
			className={`strip-tile${brightness ? " quick-brightness" : ""}`}
			data-type={tile.type}
			style={{ borderRadius: tile.tileRadius }}
		>
			<span className="console-key-address" aria-hidden="true">
				{tile.keyCode}
			</span>
			<div
				ref={artwork.ref}
				data-tile-artwork-state={artwork.state}
				data-themed-artwork={artwork.monochrome && !!artwork.src}
				className="strip-tile-icon"
				style={{
					...(artwork.monochrome && artwork.src
						? { maskImage: `url("${artwork.src}")` }
						: {}),
					width: brightness ? 32 : titleAware ? iconWidth : 64,
					height: brightness ? 32 : titleAware ? iconHeight : 64,
					left: titleAware ? "50%" : 24,
					transform: titleAware ? "translate(-50%, -50%)" : "none",
					top: fullArtwork
						? "50%"
						: titleAware
							? `${metrics.iconCenter * 100}%`
							: brightness
								? 24
								: 28,
				}}
			>
				{artwork.src ? (
					<img src={artwork.src} alt="" draggable={false} />
				) : null}
			</div>
			{brightness ? (
				<div className="quick-brightness-state">
					<output data-unavailable={percent === undefined}>
						{percent === undefined ? t("unavailable") : `${percent}%`}
					</output>
					<span>{t("brightnessKnob")}</span>
				</div>
			) : null}
			{config.title.display ? (
				<p
					className="strip-tile-title"
					data-full-title={title}
					data-custom-style={explicit}
					style={{
						fontSize,
						fontWeight: metrics.fontWeight,
						fontStyle,
						textDecoration:
							explicit && styles.includes("underline") ? "underline" : "none",
						color: explicit ? config.title.color : undefined,
						width: brightness
							? "calc(100% - 120px)"
							: explicit
								? metrics.titleWidth
								: "calc(100% - 48px)",
						...placement,
					}}
				>
					{title}
				</p>
			) : null}
		</div>
	);
}

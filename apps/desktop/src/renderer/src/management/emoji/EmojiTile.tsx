import { useEffect, useState } from "react";
import { STRIP_PALETTE } from "../../strip/palette";
import { genericTileMetrics } from "../../strip/tileMetrics";
import type { StripTileProps } from "../../strip/tileRegistry";
import { GenericTile } from "../../strip/tiles/GenericTile";
import { useTruncatedTitle } from "../../strip/useTileArt";
/** Saved keys pin an immutable hash, including GIFs removed from the package. */
export function EmojiTile(props: StripTileProps): React.JSX.Element {
	const hash = props.tile.key.config.icon.startsWith("emoji:")
		? props.tile.key.config.icon.slice(6)
		: "";
	const [source, setSource] = useState("");
	const [unavailable, setUnavailable] = useState(false);
	const { title } = props.tile.key.config;
	const explicit = title.userModifiedStyle === true;
	const metrics = genericTileMetrics(props.tile.box, {
		pos: title.pos,
		style: title.style,
		userModifiedStyle: explicit,
	});
	const fontStyle = metrics.italic ? "italic" : "normal";
	const fontSize = explicit
		? Math.round(metrics.fontSize * (title.size / 8))
		: metrics.fontSize;
	const label = useTruncatedTitle(
		title.text,
		metrics.titleWidth,
		`${fontStyle} ${metrics.fontWeight} ${fontSize}px ${STRIP_PALETTE.font}`,
	);
	useEffect(() => {
		let active = true;
		setSource("");
		setUnavailable(false);
		if (/^[a-f0-9]{64}$/.test(hash)) {
			const bridge = window.quakeEmoji;
			if (!bridge) setUnavailable(true);
			else
				void bridge
					.request({ type: "asset", hash })
					.then((reply) => {
						if (!active) return;
						const value =
							reply._tag === "ready" ? (reply.assets[hash] ?? "") : "";
						setSource(value);
						setUnavailable(!value);
					})
					.catch(() => {
						if (active) setUnavailable(true);
					});
		} else if (hash) setUnavailable(true);
		return () => {
			active = false;
		};
	}, [hash]);
	if (!hash)
		return (
			<div
				data-emoji-asset-state={props.tile.key.config.icon ? "ready" : "empty"}
				style={{ display: "contents" }}
			>
				<GenericTile {...props} />
			</div>
		);
	const side = Math.min(props.tile.box.width, props.tile.box.height) * 0.8;
	return (
		<div
			className="strip-tile"
			data-type="emoji"
			data-emoji-asset-state={
				unavailable ? "unavailable" : source ? "ready" : "loading"
			}
			style={{ borderRadius: props.tile.tileRadius }}
		>
			{source && !unavailable ? (
				<img
					src={source}
					alt=""
					draggable={false}
					onError={() => setUnavailable(true)}
					style={{
						position: "absolute",
						width: side,
						height: side,
						objectFit: "contain",
						left: "50%",
						top: "50%",
						transform: "translate(-50%, -50%)",
					}}
				/>
			) : (
				<span
					role="img"
					aria-label="Emoji unavailable"
					style={{
						position: "absolute",
						inset: 0,
						display: "grid",
						placeItems: "center",
						fontSize: 48,
					}}
				>
					▦
				</span>
			)}
			{title.display ? (
				<p
					className="strip-tile-title"
					style={{
						fontSize,
						fontWeight: metrics.fontWeight,
						fontStyle,
						textDecoration:
							explicit && title.style.split("|").includes("underline")
								? "underline"
								: "none",
						color: explicit ? title.color : undefined,
						width: metrics.titleWidth,
						...(metrics.titleAnchor === "top"
							? { top: metrics.padding }
							: metrics.titleAnchor === "mid"
								? { top: "50%", transform: "translate(-50%, -50%)" }
								: { bottom: metrics.padding }),
					}}
				>
					{label}
				</p>
			) : null}
		</div>
	);
}

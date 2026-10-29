import { useLocaleText } from "../../i18n";
import { genericTileMetrics } from "../tileMetrics";
import type { StripTileProps } from "../tileRegistry";

/** Readback comes from the existing revision-scoped runtime stream. */
export function ConsoleVolumeTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const t = useLocaleText("picker");
	const level = context.runtimeState?.volume;
	const title = tile.key.config.title;
	const custom = title.userModifiedStyle === true;
	const metrics = genericTileMetrics(tile.box, title);
	const placement =
		metrics.titleAnchor === "top"
			? { top: metrics.padding }
			: metrics.titleAnchor === "mid"
				? { top: "50%", transform: "translate(-50%, -50%)" }
				: { bottom: metrics.padding };
	return (
		<div
			className="console-volume"
			style={{ width: tile.box.width, height: tile.box.height }}
		>
			<header>
				{title.display && !custom ? <span>{title.text}</span> : null}
				<span>{context.runtimeState?.muted ? t("muted") : ""}</span>
			</header>
			{title.display && custom ? (
				<div
					className="console-volume-title"
					style={{
						position: "absolute",
						left: "50%",
						zIndex: 2,
						transform: "translateX(-50%)",
						width: metrics.titleWidth,
						fontSize: metrics.fontSize,
						fontWeight: metrics.fontWeight,
						fontStyle: metrics.italic ? "italic" : "normal",
						textDecoration: title.style.split("|").includes("underline")
							? "underline"
							: "none",
						color: title.color,
						textAlign: "center",
						...placement,
					}}
				>
					{title.text}
				</div>
			) : null}
			<div className="console-volume-value">
				{level === undefined ? "—" : Math.round(level)}
				<small>%</small>
			</div>
			<div
				className="console-volume-meter"
				title={level === undefined ? t("unavailable") : `${level}%`}
			>
				<span style={{ width: `${level ?? 0}%` }} />
			</div>
			<p>{t("volumeKnob")}</p>
		</div>
	);
}

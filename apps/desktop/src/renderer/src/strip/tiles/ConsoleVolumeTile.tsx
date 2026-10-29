import { useLocaleText } from "../../i18n";
import type { StripTileProps } from "../tileRegistry";

/** Readback comes from the existing revision-scoped runtime stream. */
export function ConsoleVolumeTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const t = useLocaleText("picker");
	const level = context.runtimeState?.volume;
	return (
		<div
			className="console-volume"
			style={{ width: tile.box.width, height: tile.box.height }}
		>
			<header>
				{tile.key.config.title.text}
				<span>{context.runtimeState?.muted ? t("muted") : ""}</span>
			</header>
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

import { useId } from "react";
import { importSoundConfig } from "../../../../../../../../packages/edge/src/soundboard/soundboard-invariants";
import { stripPaletteProperties } from "../../palette";
import type { StripTileProps } from "../../tileRegistry";
import { GenericTile } from "../GenericTile";
import { soundboardLabels as labels } from "./strings";
import "./soundboard.css";

const palette = stripPaletteProperties();

export function SoundboardUnavailableTile(
	props: StripTileProps,
): React.JSX.Element {
	const { tile } = props;
	const detailId = useId();
	const parsed = importSoundConfig({
		type: tile.key.config.type,
		actions: tile.key.config.actions,
	});
	const configured =
		parsed._tag === "Right" &&
		parsed.right.issues.every((issue) => issue === "unverifiedFiles");
	if (configured)
		return (
			<fieldset
				className="oq-soundboard-unavailable"
				data-state="configured"
				data-testid="soundboard-local"
				aria-label="Local Music"
				style={{ ...palette, width: tile.box.width, height: tile.box.height }}
			>
				<GenericTile {...props} />
				<span className="strip-key-chip">Play Audio</span>
			</fieldset>
		);
	return (
		<fieldset
			className="oq-soundboard-unavailable"
			aria-label={labels.accessibleName}
			aria-describedby={detailId}
			data-state="unavailable"
			data-testid="soundboard-unavailable"
			data-type={tile.type}
			style={{ ...palette, width: tile.box.width, height: tile.box.height }}
		>
			{tile.fullBleed ? (
				<div
					className="oq-soundboard-stage"
					style={{
						transform: `scale(${tile.box.width / 1920}, ${tile.box.height / 480})`,
					}}
				>
					<div className="oq-player-cover">
						<svg
							viewBox="0 0 24 24"
							aria-hidden="true"
							style={{ opacity: 0.55 }}
						>
							<path d="M3 5h13M3 10h9M3 15h6M19 9v10M19 9l3-1" />
							<ellipse cx="16.5" cy="19" rx="2.5" ry="2" />
						</svg>
					</div>
					<div className="oq-player-info">
						<p className="oq-player-source" data-active="false">
							{labels.source}
						</p>
						<p className="oq-player-title">{labels.title}</p>
						<p className="oq-soundboard-detail" id={detailId}>
							{labels.detail}
						</p>
					</div>
				</div>
			) : (
				<>
					<GenericTile {...props} />
					<span className="strip-key-chip" data-kind="unavailable">
						{labels.compact}
					</span>
					<span className="oq-soundboard-description" id={detailId}>
						{labels.detail}
					</span>
				</>
			)}
		</fieldset>
	);
}

import { useEffect, useId, useState } from "react";
import { WEATHER_MEDIA_STRINGS } from "../../../../../shared/weather-media-strings";
import { storedKeyLocale } from "../../../keys/key-locale";
import {
	TransportButton,
	TransportGlyph,
} from "../../../weather-media/TransportButton";
import { stripPaletteProperties } from "../../palette";
import type { StripTileProps } from "../../tileRegistry";
import { GenericTile } from "../GenericTile";
import { soundboardConfigured } from "./soundboard-state";
import { soundboardLabels as labels, localPlayerLabels } from "./strings";
import "./soundboard.css";

const palette = stripPaletteProperties();

export function SoundboardUnavailableTile(
	props: StripTileProps,
): React.JSX.Element {
	const { tile, context } = props;
	const [locale, setLocale] = useState(storedKeyLocale);
	useEffect(() => {
		const change = () => setLocale(storedKeyLocale());
		window.addEventListener("key-locale", change);
		return () => window.removeEventListener("key-locale", change);
	}, []);
	const local = localPlayerLabels[locale],
		transport = WEATHER_MEDIA_STRINGS[locale].clock;
	const control = (intent: "previous" | "toggle" | "next" | "stop"): void => {
		if (context.interactive === false || !context.keyTarget) return;
		void window.quakeKeyLibrary?.request({
			type: "player-control",
			...context.keyTarget,
			keyCode: tile.keyCode,
			intent,
		});
	};
	const detailId = useId();
	const configured = soundboardConfigured(tile.key.config);
	if (configured)
		return (
			<fieldset
				className="oq-soundboard-unavailable"
				data-state="configured"
				data-testid="soundboard-local"
				aria-label={local.source}
				style={{ ...palette, width: tile.box.width, height: tile.box.height }}
			>
				{tile.fullBleed ? (
					<>
						<div className="oq-player-cover" aria-hidden="true">
							<svg viewBox="0 0 24 24" aria-hidden="true">
								<path d="M3 5h13M3 10h9M3 15h6M19 9v10M19 9l3-1" />
								<ellipse cx="16.5" cy="19" rx="2.5" ry="2" />
							</svg>
						</div>
						<div className="oq-player-info">
							<p className="oq-player-source">{local.source}</p>
							<p className="oq-player-title">
								{tile.key.config.title.text || local.source}
							</p>
						</div>
					</>
				) : (
					<GenericTile {...props} />
				)}
				<div
					className="oq-player-controls oq-local-controls"
					data-full-bleed={tile.fullBleed}
				>
					{(
						[
							[
								"previous",
								"audioPlayerViewBackwards",
								transport.musicPrev,
								"previous",
							],
							["toggle", "playStop", local.toggle, "play"],
							["next", "audioPlayerViewForwards", transport.musicNext, "next"],
							["stop", "playStopActive", local.stop, "stop"],
						] as const
					).map(([intent, id, label, kind]) => (
						<TransportButton
							key={id}
							id={id}
							label={label}
							disabled={context.interactive === false || !context.keyTarget}
							onPress={() => control(intent)}
						>
							<TransportGlyph kind={kind} />
						</TransportButton>
					))}
				</div>
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

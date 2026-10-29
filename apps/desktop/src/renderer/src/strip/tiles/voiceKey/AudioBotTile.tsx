import { useRef } from "react";
import { useSubTouchTap } from "../../overlays/voice/sub-touch";
import type { StripTileProps } from "../../tileRegistry";
import { GenericTile } from "../GenericTile";
import { readerSettings } from "./reader-settings";
import "./audioBot.css";

/** The reader is armed by a release, and its phase comes only from the main speech owner. */
export function AudioBotTile(props: StripTileProps): React.JSX.Element {
	const { tile, context } = props;
	const enabled =
		context.voice.surface === "panel" && context.interactive !== false;
	const phase = enabled
		? (context.voice.view.readAloud.get(tile.keyCode)?.phase ?? "idle")
		: "idle";
	const ref = useRef<HTMLButtonElement>(null);
	const toggle = () => {
		if (enabled)
			void context.voice
				.request({
					_tag: "ToggleReader",
					keyCode: tile.keyCode,
					settings: readerSettings(tile.key.config.actions),
				})
				.then((reply) => {
					if (reply._tag === "rejected")
						context.voice.toast("aiAudio.openClawNotReady");
				});
	};
	useSubTouchTap(ref, toggle);
	return (
		<button
			ref={ref}
			type="button"
			className="audio-bot-key"
			data-quake-sub-touch="audioBotReader"
			data-phase={phase}
			disabled={!enabled}
			aria-pressed={phase !== "idle"}
			aria-label={tile.key.config.title.text || "Voice assistant"}
			onClick={toggle}
		>
			<GenericTile {...props} />
			<span
				className="audio-bot-state"
				role="status"
				aria-label={phase}
				style={{
					width: Math.max(52, tile.box.width * 0.9),
					height: Math.max(
						30,
						Math.min(tile.box.width, tile.box.height) * 0.26,
					),
				}}
			>
				{phase === "speaking" ? (
					[0, 1, 2, 3, 4, 5, 6].map((i) => (
						<i key={i} style={{ animationDelay: `${i * 0.07}s` }} />
					))
				) : phase === "thinking" ? (
					<>
						<i />
						<i />
						<i />
					</>
				) : null}
			</span>
		</button>
	);
}

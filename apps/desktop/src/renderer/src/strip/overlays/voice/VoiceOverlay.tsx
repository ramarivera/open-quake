import { Option } from "effect";
import "../../css-properties";
import { MarqueeText } from "./MarqueeText";
import { BAR_HEIGHT, BAR_WIDTH } from "./mountain-bar";
import type { StripLocale } from "./strings";
import { MountainCanvas, WaveformCanvas } from "./VoiceCanvases";
import { overlayLine, toastText, voiceTextString } from "./voice-context";
import type { VoiceView } from "./voice-state";
import "./voice.css";

const CANVAS = { width: 1920, height: 480 } as const;

/**
 * The full-screen voice backdrop and the mic bar, above the grid and every
 * tile overlay, with no pointer events (QSV:161-182, 441-460).
 */
export function VoiceOverlay({
	view,
	locale,
	motion,
}: {
	view: VoiceView;
	locale: StripLocale;
	motion: "full" | "reduce";
}): React.JSX.Element | null {
	const { overlay, bar } = view;
	if (!overlay.visible && !bar.visible) return null;
	const barRow =
		bar.visible && !overlay.visible
			? Option.map(bar.text, (text) => voiceTextString(locale, text))
			: Option.none<string>();
	return (
		<div className="voice-overlay" data-bar={bar.visible || undefined}>
			{overlay.visible ? (
				<div
					className="voice-backdrop"
					data-countdown={Option.isSome(overlay.countdown) || undefined}
				>
					<div className="voice-waveform" aria-hidden="true">
						<WaveformCanvas {...CANVAS} motion={motion} />
					</div>
					<div className="voice-dim" />
					<MarqueeText
						className="voice-subtitle"
						text={overlayLine(view, locale)}
						seconds={10}
						motion={motion}
					/>
				</div>
			) : null}
			{bar.visible ? (
				<div
					className="voice-bar"
					data-key-code={bar.keyCode}
					data-overlay={overlay.visible || undefined}
				>
					{Option.isSome(barRow) && barRow.value !== "" ? (
						<MarqueeText
							className="voice-bar-row"
							text={barRow.value}
							seconds={12}
							motion={motion}
						/>
					) : null}
					<MountainCanvas
						width={BAR_WIDTH}
						height={BAR_HEIGHT}
						rms={bar.rms}
						speaking={bar.speaking}
						motion={motion}
					/>
				</div>
			) : null}
		</div>
	);
}

/** Element UI's warning `$message`, enlarged for the strip (ACV:1420-1437, QSC:5514-5598). */
export function StripToasts({
	view,
	locale,
}: {
	view: VoiceView;
	locale: StripLocale;
}): React.JSX.Element | null {
	const toast = view.toasts.at(-1);
	if (!toast) return null;
	return (
		<div className="voice-toast" role="status" key={toast.id}>
			<svg className="voice-toast-icon" viewBox="0 0 28 28" aria-hidden="true">
				<circle cx="14" cy="14" r="14" />
				<rect x="12.5" y="6.5" width="3" height="10" rx="1.5" />
				<circle cx="14" cy="20.5" r="1.8" />
			</svg>
			<span className="voice-toast-text">{toastText(locale, toast)}</span>
		</div>
	);
}

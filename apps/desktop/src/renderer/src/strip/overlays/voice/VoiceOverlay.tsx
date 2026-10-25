import { Option } from "effect";
import "../../css-properties";
import { BAR_HEIGHT, BAR_WIDTH } from "./level-meter";
import { MarqueeText } from "./MarqueeText";
import type { StripLocale } from "./strings";
import { LevelMeterCanvas } from "./VoiceCanvases";
import { overlayLine, toastText, voiceTextString } from "./voice-context";
import type { VoiceView } from "./voice-state";
import "./voice.css";

export type VoicePhase = "listening" | "processing" | "error" | "notice";

/** What the overlay is telling the user, for its glyph and tone. */
export function voicePhase(view: VoiceView): VoicePhase {
	if (Option.isSome(view.overlay.countdown)) return "error";
	if (view.bar.visible) return "listening";
	const text = Option.getOrUndefined(view.overlay.text);
	if (text?._tag === "string" && text.key === "aiAudio.processing")
		return "processing";
	if (text?._tag === "transcript") return "processing";
	if (text?._tag === "errorCode") return "error";
	return "notice";
}

function PhaseGlyph({ phase }: { phase: VoicePhase }): React.JSX.Element {
	return (
		<span className="voice-glyph" data-phase={phase} aria-hidden="true">
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{phase === "listening" ? (
					<>
						<rect x="9" y="3" width="6" height="11" rx="3" />
						<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
					</>
				) : phase === "processing" ? (
					<>
						<circle cx="6" cy="12" r="1.6" />
						<circle cx="12" cy="12" r="1.6" />
						<circle cx="18" cy="12" r="1.6" />
					</>
				) : (
					<path d="M12 7v6M12 16.8v.2" />
				)}
			</svg>
		</span>
	);
}

/**
 * The full-screen voice sheet and the mic meter, above the grid and every
 * tile overlay, with no pointer events.
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
	const phase = voicePhase(view);
	return (
		<div className="voice-overlay" data-bar={bar.visible || undefined}>
			{overlay.visible ? (
				<div
					className="voice-backdrop"
					data-phase={phase}
					data-countdown={Option.isSome(overlay.countdown) || undefined}
				>
					<PhaseGlyph phase={phase} />
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
					<LevelMeterCanvas
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

/** Strip toasts: an opaque raised pill with a state glyph and readable text. */
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

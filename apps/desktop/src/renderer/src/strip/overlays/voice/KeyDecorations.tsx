import type { KeyAlertKind } from "../../../../../shared/voice-surface";
import "./voice.css";

/**
 * DK's DisplayEvent `showAlert` over one tile (DEV:7-9, 375-377): a 50×50
 * glyph on an rgb(255,255,100) block. Glyphs are drawn here; DK's PNGs are
 * not copied.
 */
export function KeyAlert({
	alert,
}: {
	alert: KeyAlertKind;
}): React.JSX.Element {
	return (
		<div className="voice-key-alert" data-alert={alert}>
			<svg
				className="voice-key-alert-block"
				viewBox="0 0 50 50"
				aria-hidden="true"
			>
				{alert === "invalid" ? (
					<>
						<rect x="21" y="8" width="8" height="24" rx="4" />
						<circle cx="25" cy="40" r="4.5" />
					</>
				) : alert === "checkmark" ? (
					<path d="M11 26l9 9 19-20" />
				) : (
					<rect x="13" y="13" width="24" height="24" rx="3" />
				)}
			</svg>
		</div>
	);
}

/** AI cancel indicator, 120×120 in a 240 viewBox (QSC:173-236, SCREEN-045). */
export function CancelIndicator({ id }: { id: string }): React.JSX.Element {
	const mask = `voice-cancel-mask-${id}`;
	return (
		<svg
			className="voice-cancel-indicator"
			width="120"
			height="120"
			viewBox="0 0 240 240"
			fill="none"
			aria-hidden="true"
		>
			<defs>
				<mask id={mask}>
					<rect x="0" y="0" width="240" height="240" fill="white" />
					<rect x="70" y="70" width="100" height="100" rx="16" fill="black" />
				</mask>
			</defs>
			<circle
				cx="120"
				cy="120"
				r="100"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.8"
				vectorEffect="non-scaling-stroke"
			/>
			<circle
				cx="120"
				cy="120"
				r="92"
				fill="white"
				fillOpacity="0.3"
				mask={`url(#${mask})`}
			/>
			<rect
				x="74"
				y="74"
				width="92"
				height="92"
				rx="12"
				fill="#8B0000"
				fillOpacity="0.8"
			/>
		</svg>
	);
}

/** The selected clawbot key's 20 px green dot (UnitControl.vue:3157-3179). */
export function ClawbotDot(): React.JSX.Element {
	return <span className="voice-clawbot-dot" aria-hidden="true" />;
}

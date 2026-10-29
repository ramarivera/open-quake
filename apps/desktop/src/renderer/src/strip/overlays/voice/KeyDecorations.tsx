import type { KeyAlertKind } from "../../../../../shared/voice-surface";
import "./voice.css";

/**
 * A key alert over one tile: a 50×50 state glyph on an opaque raised disc,
 * toned by the alert (invalid, done or stopped).
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

/** AI cancel indicator, 120×120: a stop target on an opaque disc. */
export function CancelIndicator({ id }: { id: string }): React.JSX.Element {
	return (
		<svg
			className="voice-cancel-indicator"
			data-id={id}
			width="120"
			height="120"
			viewBox="0 0 240 240"
			fill="none"
			aria-hidden="true"
		>
			<circle
				cx="120"
				cy="120"
				r="104"
				fill="var(--strip-raised)"
				stroke="var(--strip-danger)"
				strokeWidth="6"
			/>
			<rect
				x="84"
				y="84"
				width="72"
				height="72"
				rx="10"
				fill="var(--strip-danger)"
			/>
		</svg>
	);
}

/** The selected clawbot key's 20 px dot. */
export function ClawbotDot(): React.JSX.Element {
	return <span className="voice-clawbot-dot" aria-hidden="true" />;
}

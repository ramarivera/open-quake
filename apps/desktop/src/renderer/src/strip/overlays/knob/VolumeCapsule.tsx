import { useRef } from "react";
import type { KnobModelSnapshot } from "../../../../../shared/knob-contracts";

export function VolumeCapsule({
	volume,
	toggle,
	readOnly = false,
}: {
	volume: KnobModelSnapshot["volume"];
	toggle: () => void;
	readOnly?: boolean;
}): React.JSX.Element {
	const suppressClickUntil = useRef(0);
	const phase = readOnly ? "inactive" : volume.phase;
	return (
		<button
			type="button"
			className="knob-volume"
			data-phase={phase}
			aria-pressed={phase === "active"}
			aria-label={volume.muted ? "Mute" : `Volume ${volume.level}`}
			disabled={readOnly || phase === "activating" || phase === "unavailable"}
			onPointerUp={(event) => {
				if (event.pointerType === "touch") {
					suppressClickUntil.current = Date.now() + 600;
					toggle();
				}
			}}
			onClick={() => {
				if (Date.now() >= suppressClickUntil.current) toggle();
			}}
		>
			<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M3 9h4l5-4v14l-5-4H3z"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				/>
				<path
					d={volume.muted ? "m16 9 5 6m0-6-5 6" : "M16 8q5 4 0 8M19 5q7 7 0 14"}
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				/>
			</svg>
			<span className="knob-volume-track">
				<span style={{ width: `${volume.level}%` }} />
			</span>
			<span className="knob-volume-number">
				{phase === "unavailable" ? "--" : volume.level}
				<small>%</small>
			</span>
		</button>
	);
}

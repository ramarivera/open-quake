import { useEffect, useRef, useState } from "react";
import type { ClockDigits } from "./clockTime";
import { FlipSequencer, type FlipState } from "./flipSequencer";

/** Only the minute-ones column flips; everything else snaps (BR-02). */
function useMinuteFlip(digit: number, reducedMotion: boolean): FlipState {
	const [state, setState] = useState<FlipState>({
		upper: digit,
		phase: "rest",
	});
	const sequencer = useRef<FlipSequencer | null>(null);
	const initial = useRef(digit);
	useEffect(() => {
		const instance = new FlipSequencer(initial.current, setState);
		sequencer.current = instance;
		return () => {
			instance.dispose();
			sequencer.current = null;
		};
	}, []);
	useEffect(() => {
		sequencer.current?.set(digit, reducedMotion);
	}, [digit, reducedMotion]);
	return state;
}

function Card({ digit }: { digit: number }): React.JSX.Element {
	return (
		<div className="oq-flip">
			<div className="oq-flip-upper">
				<span className="oq-flip-digit">{digit}</span>
			</div>
			<div className="oq-flip-lower">
				<span className="oq-flip-digit">{digit}</span>
			</div>
		</div>
	);
}

export function FlipClock({
	digits,
	showSeconds,
	reducedMotion,
}: {
	digits: ClockDigits;
	showSeconds: boolean;
	reducedMotion: boolean;
}): React.JSX.Element {
	const flip = useMinuteFlip(digits.minuteOnes, reducedMotion);
	const phase = flip.phase === "rest" ? "" : ` ${flip.phase}`;
	return (
		<div
			className="oq-flip-clock"
			data-time={`${digits.hourTens}${digits.hourOnes}:${digits.minuteTens}${digits.minuteOnes}`}
		>
			<Card digit={digits.hourTens} />
			<Card digit={digits.hourOnes} />
			<div className="oq-flip-colon" aria-hidden="true">
				<i />
				<i />
			</div>
			<Card digit={digits.minuteTens} />
			<div className="oq-flip" data-flip={flip.phase}>
				<div className={`oq-flip-upper${phase}`}>
					<span className="oq-flip-digit">{flip.upper}</span>
				</div>
				<div className="oq-flip-lower">
					<span className="oq-flip-digit">{digits.minuteOnes}</span>
				</div>
			</div>
			{digits.meridiem || showSeconds ? (
				<div className="oq-flip-side">
					{digits.meridiem ? (
						<span className="oq-flip-pill">{digits.meridiem}</span>
					) : null}
					{showSeconds ? (
						<span className="oq-flip-pill is-seconds">{digits.seconds}</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

import type { ClockDigits } from "./clockTime";

/**
 * Hours and minutes as one tabular readout, with AM/PM and seconds as a
 * smaller second column (independent-device-design, "Typographic clock").
 * One accessible label carries the complete time.
 */
export function TimeReadout({
	digits,
	showSeconds,
}: {
	digits: ClockDigits;
	showSeconds: boolean;
}): React.JSX.Element {
	const hours = `${digits.hourTens}${digits.hourOnes}`;
	const minutes = `${digits.minuteTens}${digits.minuteOnes}`;
	const time = `${hours}:${minutes}`;
	const label = `${time}${showSeconds ? `:${digits.seconds}` : ""}${digits.meridiem ? ` ${digits.meridiem}` : ""}`;
	return (
		<div
			className="oq-clock-time"
			data-time={time}
			role="img"
			aria-label={label}
		>
			<span className="oq-clock-hm" aria-hidden="true">
				<span>{hours}</span>
				<span className="oq-clock-colon">:</span>
				<span>{minutes}</span>
			</span>
			{digits.meridiem || showSeconds ? (
				<span className="oq-clock-aside" aria-hidden="true">
					{digits.meridiem ? (
						<span className="oq-clock-meridiem">{digits.meridiem}</span>
					) : null}
					{showSeconds ? (
						<span className="oq-clock-seconds">{digits.seconds}</span>
					) : null}
				</span>
			) : null}
		</div>
	);
}

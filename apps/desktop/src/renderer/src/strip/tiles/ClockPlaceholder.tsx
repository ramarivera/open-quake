import { formatClock, type HourFormat } from "../../../../shared/display";

/**
 * Stand-in for strip-clock's `ClockTile` (same props, plus the saved hour
 * format). It keeps the first-release clock (device-screen-wallpaper) on the
 * strip until the 0.4.95 flip clock lands.
 */
export function ClockPlaceholder({
	widthPx,
	heightPx,
	now,
	theme,
	hourFormat = "24h",
}: {
	widthPx: number;
	heightPx: number;
	now: Date;
	theme: string;
	hourFormat?: HourFormat;
}): React.JSX.Element {
	const time = formatClock(
		{
			epochMillis: now.getTime(),
			hour: now.getHours(),
			minute: now.getMinutes(),
			second: now.getSeconds(),
		},
		hourFormat,
	);
	const [hms = "", meridiem] = time.split(" ");
	return (
		<svg
			className="strip-clock-placeholder"
			viewBox={`0 0 ${widthPx} ${heightPx}`}
			width={widthPx}
			height={heightPx}
			data-theme={theme}
			data-time={time}
			role="img"
			aria-label={`Clock ${time}`}
		>
			<text
				x={widthPx / 2}
				y={heightPx / 2}
				className="strip-clock-placeholder-time"
			>
				{hms}
				{meridiem ? (
					<tspan className="strip-clock-placeholder-meridiem" dx="24">
						{meridiem}
					</tspan>
				) : null}
			</text>
		</svg>
	);
}

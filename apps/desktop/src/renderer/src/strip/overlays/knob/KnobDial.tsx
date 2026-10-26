import { STRIP_PALETTE } from "../../palette";

/**
 * The focused tile's knob state: an accent ring around the tile and a compact
 * gauge whose pointer turns by the detent angle. Mount inside the tile; the
 * caller owns the tile's bounds and touch target.
 */
export function KnobDial({
	width,
	height,
	angle,
	accent = STRIP_PALETTE.accent,
}: {
	width: number;
	height: number;
	angle: number;
	accent?: string;
}): React.JSX.Element {
	const radius = Math.floor(Math.min(width, height) * 0.24);
	const cx = width / 2;
	const cy = height / 2;
	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className="knob-dial"
			aria-label="Knob focus"
			role="img"
		>
			<title>Knob focus</title>
			<rect
				x="2"
				y="2"
				width={width - 4}
				height={height - 4}
				rx="26"
				fill="none"
				stroke={accent}
				strokeWidth="2"
			/>
			<circle
				cx={cx}
				cy={cy}
				r={radius}
				fill={STRIP_PALETTE.raised}
				stroke={STRIP_PALETTE.line}
				strokeWidth="4"
			/>
			<g transform={`rotate(${angle} ${cx} ${cy})`}>
				<line
					x1={cx}
					y1={cy - radius * 0.35}
					x2={cx}
					y2={cy - radius + 2}
					stroke={accent}
					strokeWidth="8"
					strokeLinecap="round"
				/>
			</g>
		</svg>
	);
}

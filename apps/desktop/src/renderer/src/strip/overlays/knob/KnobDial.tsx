/**
 * The focused tile's knob state: a quiet outline without a decorative gauge.
 * Mount inside the tile; the
 * caller owns the tile's bounds and touch target.
 */
export function KnobDial({
	width,
	height,
	angle: _angle,
	accent = "var(--strip-selection)",
}: {
	width: number;
	height: number;
	angle: number;
	accent?: string;
}): React.JSX.Element {
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
				rx="4"
				fill="none"
				stroke={accent}
				strokeWidth="2"
			/>
		</svg>
	);
}

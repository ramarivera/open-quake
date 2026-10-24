import { useId } from "react";

/** Mount inside the tile; the caller owns the tile's bounds and touch target. */
export function KnobDial({
	width,
	height,
	angle,
	accent = "#00ffff",
}: {
	width: number;
	height: number;
	angle: number;
	accent?: string;
}): React.JSX.Element {
	const id = `knob-metal-${useId().replace(/[^\w-]/g, "")}`;
	const diameter = Math.floor(Math.min(width, height) * 0.65);
	const radius = diameter / 2;
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
			<defs>
				<radialGradient id={id}>
					<stop stopColor="#545452" />
					<stop offset=".6" stopColor="#2a2a1e" />
					<stop offset="1" stopColor="#0d0d0b" />
				</radialGradient>
			</defs>
			<rect
				x="2"
				y="2"
				width={width - 4}
				height={height - 4}
				rx="48"
				fill="#000"
				opacity=".5"
			/>
			{Array.from({ length: 30 }, (_, index) => {
				const theta = ((index * 12 - 90) * Math.PI) / 180;
				return (
					<line
						key={theta}
						x1={cx + Math.cos(theta) * radius}
						y1={cy + Math.sin(theta) * radius}
						x2={cx + Math.cos(theta) * (radius + 12)}
						y2={cy + Math.sin(theta) * (radius + 12)}
						stroke={accent}
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				);
			})}
			<circle
				cx={cx}
				cy={cy}
				r={radius - 1}
				fill={`url(#${id})`}
				stroke={accent}
				strokeWidth="2"
				style={{ filter: `drop-shadow(0 0 8px ${accent})` }}
			/>
			<circle
				cx={cx}
				cy={cy}
				r={radius * 0.9}
				fill="none"
				stroke="#000"
				strokeWidth="2"
			/>
			<g transform={`rotate(${angle} ${cx} ${cy})`}>
				<path
					d={`M ${cx - 7} ${cy - radius - 27} h 14 l -7 -12 z`}
					fill={accent}
				/>
			</g>
		</svg>
	);
}

import { useId } from "react";
import "../../css-properties";
import "./aiCopilot.css";

/**
 * DK-Suite's GlowEnergyOrb (GEO:1-500, SCREEN-119) on a 187×193 viewBox. Every
 * animation duration is divided by `speed`; paused removes the animations.
 */
export function GlowEnergyOrb({
	width,
	height,
	speed,
	playing,
	fill = "#00FFFF",
}: {
	width: number;
	height: number;
	speed: number;
	playing: boolean;
	fill?: string;
}): React.JSX.Element {
	const id = `orb${useId().replace(/[^\w-]/g, "")}`;
	const blur = (name: string, x: number, y: number, w: number, h: number) => (
		<filter
			id={`${id}-${name}`}
			x={x}
			y={y}
			width={w}
			height={h}
			filterUnits="userSpaceOnUse"
			colorInterpolationFilters="sRGB"
		>
			<feGaussianBlur stdDeviation="12" />
		</filter>
	);
	const gloss = (
		name: string,
		x1: number,
		y1: number,
		x2: number,
		y2: number,
	) => (
		<linearGradient
			id={`${id}-${name}`}
			x1={x1}
			y1={y1}
			x2={x2}
			y2={y2}
			gradientUnits="userSpaceOnUse"
		>
			<stop stopColor="white" />
			<stop offset="1" stopColor="white" stopOpacity="0.05" />
		</linearGradient>
	);
	return (
		<div
			className="orb-root"
			data-playing={playing || undefined}
			style={{ width, height, "--orb-speed": speed }}
		>
			<svg
				viewBox="0 0 187 193"
				fill="none"
				className="orb-svg"
				aria-hidden="true"
			>
				<circle
					className="orb-core"
					cx="95.1"
					cy="91.1003"
					r="75"
					fill={fill}
				/>
				<g className="orb-cloud-left" opacity="0.6" filter={`url(#${id}-left)`}>
					<ellipse
						cx="69.1"
						cy="97.1003"
						rx="48"
						ry="57"
						fill={`url(#${id}-p0)`}
					/>
				</g>
				<g className="orb-cloud-right-a" filter={`url(#${id}-ra)`}>
					<ellipse
						cx="119.969"
						cy="124.719"
						rx="32.3341"
						ry="51.5"
						transform="rotate(-136.713 119.969 124.719)"
						fill={`url(#${id}-p1)`}
					/>
				</g>
				<g className="orb-cloud-right-b" filter={`url(#${id}-rb)`}>
					<ellipse
						cx="109.629"
						cy="62.3873"
						rx="31.807"
						ry="51.5"
						transform="rotate(122.047 109.629 62.3873)"
						fill={`url(#${id}-p2)`}
					/>
				</g>
				<ellipse
					className="orb-gloss-a"
					opacity="0.6"
					cx="65.6"
					cy="91.1003"
					rx="34.5"
					ry="51"
					fill={`url(#${id}-p3)`}
				/>
				<ellipse
					className="orb-gloss-b"
					opacity="0.6"
					cx="116.202"
					cy="68.7383"
					rx="30.5"
					ry="49.0075"
					transform="rotate(-35.0199 116.202 68.7383)"
					fill={`url(#${id}-p4)`}
				/>
				<ellipse
					className="orb-gloss-c"
					opacity="0.6"
					cx="109.1"
					cy="116.6"
					rx="46"
					ry="35.5"
					transform="rotate(-21.0194 109.1 116.6)"
					fill={`url(#${id}-p5)`}
				/>
				<defs>
					{blur("left", 0, 19.0002, 138.2, 156.2)}
					{blur("ra", 53.5285, 57.1591, 132.882, 135.12)}
					{blur("rb", 38.8155, 0, 141.628, 124.775)}
					<linearGradient
						id={`${id}-p0`}
						x1="99.013"
						y1="45.6885"
						x2="44.1068"
						y2="122.002"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#00DDFF" stopOpacity="0.75" />
						<stop offset="1" stopColor="#0088FF" />
					</linearGradient>
					<linearGradient
						id={`${id}-p1`}
						x1="140.12"
						y1="78.2683"
						x2="87.8318"
						y2="132.452"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#AA00FF" stopOpacity="0.25" />
						<stop offset="1" stopColor="#AA00FF" stopOpacity="0.85" />
					</linearGradient>
					<linearGradient
						id={`${id}-p2`}
						x1="129.451"
						y1="15.9363"
						x2="77.1397"
						y2="69.2605"
						gradientUnits="userSpaceOnUse"
					>
						<stop stopColor="#00AAFF" stopOpacity="0.25" />
						<stop offset="1" stopColor="#88FF00" stopOpacity="0.9" />
					</linearGradient>
					{gloss("p3", 78.6, 51.1002, 24.1, 86.1002)}
					{gloss("p4", 127.694, 30.301, 77.2507, 60.1043)}
					{gloss("p5", 142.542, 69.9941, 113.179, 157.728)}
				</defs>
			</svg>
		</div>
	);
}

import { useId } from "react";
import type { AmbientStyle } from "./ambient-appearance";
import type { AmbientAudio } from "./ambient-audio";

/** The same design canvas as the media renderer. Never changes key or touch geometry. */
export function AmbientBackdrop({
	style,
	audio,
}: {
	style: Exclude<AmbientStyle, "media">;
	audio: AmbientAudio;
}) {
	const id = useId().replaceAll(":", "");
	const reactive = style === "lava" || style === "ambilight";
	const state = audio.state;
	return (
		<g className={`ambient-art ambient-${style}`} data-audio-state={state}>
			<defs>
				<linearGradient id={`${id}-horizon`} x2="0" y2="1">
					<stop stopColor="var(--quake-background, #080d1a)" />
					<stop offset=".68" stopColor="var(--quake-surface, #101830)" />
					<stop
						offset="1"
						stopColor="var(--quake-selection, #69bcff)"
						stopOpacity=".62"
					/>
				</linearGradient>
				<radialGradient id={`${id}-glow-a`}>
					<stop stopColor="var(--quake-accent, #c3ee3a)" stopOpacity=".85" />
					<stop
						offset="1"
						stopColor="var(--quake-accent, #c3ee3a)"
						stopOpacity="0"
					/>
				</radialGradient>
				<radialGradient id={`${id}-glow-b`}>
					<stop stopColor="var(--quake-selection, #69bcff)" stopOpacity=".85" />
					<stop
						offset="1"
						stopColor="var(--quake-selection, #69bcff)"
						stopOpacity="0"
					/>
				</radialGradient>
				<filter id={`${id}-soft`} x="-80%" y="-100%" width="260%" height="300%">
					<feGaussianBlur stdDeviation="40" />
				</filter>
				<pattern
					id={`${id}-grid`}
					width="80"
					height="80"
					patternUnits="userSpaceOnUse"
				>
					<path
						d="M80 0H0V80"
						fill="none"
						stroke="var(--quake-border, #6c7da2)"
						strokeWidth="1"
						opacity=".18"
					/>
				</pattern>
			</defs>
			<rect width="1920" height="480" fill="var(--quake-background, #080d1a)" />
			{style === "contour" ? (
				<g fill="none" stroke="var(--quake-selection, #69bcff)">
					{Array.from({ length: 13 }, (_, value) => value * 30).map(
						(offset) => (
							<path
								key={offset}
								opacity={0.13 + (offset / 30) * 0.035}
								strokeWidth={offset % 90 === 0 ? 2 : 1}
								d={`M-80 ${75 + offset} C340 ${-180 + (offset / 30) * 32}, 480 ${540 - (offset / 30) * 12}, 940 ${200 + (offset / 30) * 16} S1480 ${-90 + (offset / 30) * 36}, 2000 ${150 + (offset / 30) * 22}`}
							/>
						),
					)}
				</g>
			) : null}
			{style === "horizon" ? (
				<>
					<rect width="1920" height="480" fill={`url(#${id}-horizon)`} />
					<path
						d="M0 338 Q480 268 960 333 T1920 306"
						stroke="var(--quake-accent, #c3ee3a)"
						strokeWidth="2"
						fill="none"
						opacity=".7"
					/>
					{[0, 1, 2, 3].map((value) => (
						<path
							key={value}
							d={`M0 ${360 + value * 32} Q480 ${290 + value * 36} 960 ${360 + value * 32} T1920 ${340 + value * 36}`}
							fill="none"
							stroke="var(--quake-selection, #69bcff)"
							opacity=".25"
						/>
					))}
				</>
			) : null}
			{style === "plotter" ? (
				<>
					<rect width="1920" height="480" fill={`url(#${id}-grid)`} />
					<g
						fill="none"
						stroke="var(--quake-accent, #c3ee3a)"
						strokeWidth="2"
						opacity=".75"
					>
						<path d="M120 340H360V140H680V290H1000V100H1380V220H1800" />
						{[360, 680, 1000, 1380].map((x, index) => (
							<circle
								key={x}
								cx={x}
								cy={[140, 290, 100, 220][index]}
								r="8"
								fill="var(--quake-background, #080d1a)"
							/>
						))}
					</g>
				</>
			) : null}
			{style === "lava" ? (
				<g filter={`url(#${id}-soft)`}>
					{[160, 480, 800, 1120, 1440, 1760].map((x, index) => {
						const band = [audio.low, audio.mid, audio.high][index % 3] ?? 0;
						return (
							<ellipse
								key={x}
								className={`ambient-blob ambient-blob-${index}`}
								cx={x}
								cy={index % 2 === 0 ? 310 : 160}
								rx={100 + band * 140}
								ry={90 + band * 160}
								fill={
									index % 2 === 0
										? "var(--quake-accent, #c3ee3a)"
										: "var(--quake-selection, #69bcff)"
								}
								opacity={0.32 + band * 0.58}
							/>
						);
					})}
				</g>
			) : null}
			{style === "ambilight" ? (
				<g>
					{[180, 710, 1240, 1800].map((x, index) => (
						<ellipse
							key={x}
							cx={x}
							cy={index % 2 === 0 ? 440 : 20}
							rx={
								370 +
								([audio.low, audio.mid, audio.high, audio.low][index] ?? 0) *
									250
							}
							ry={
								190 +
								([audio.low, audio.mid, audio.high, audio.low][index] ?? 0) *
									280
							}
							fill={`url(#${id}-glow-${index % 2 === 0 ? "b" : "a"})`}
							style={{
								color:
									index % 2 === 0
										? "var(--quake-selection, #69bcff)"
										: "var(--quake-accent, #c3ee3a)",
							}}
							opacity={
								0.25 +
								([audio.low, audio.mid, audio.high, audio.low][index] ?? 0) *
									0.75
							}
						/>
					))}
				</g>
			) : null}
			{reactive ? (
				<g
					className="ambient-source"
					aria-label={
						state === "live"
							? "Background media audio, live"
							: state === "silent"
								? "Background media audio, silent"
								: state === "unavailable"
									? "Background audio unavailable"
									: "Waiting for background media audio"
					}
				>
					<rect
						x="24"
						y="412"
						width="710"
						height="44"
						rx="4"
						fill="var(--quake-background, #080d1a)"
						opacity=".94"
					/>
					<circle
						cx="46"
						cy="434"
						r="5"
						fill={
							state === "live"
								? "var(--quake-success, #9cdb78)"
								: "var(--quake-muted, #a3aecc)"
						}
					/>
					<text x="62" y="441" fontSize="21" fill="var(--quake-muted, #a3aecc)">
						{state === "live"
							? "BACKGROUND MEDIA AUDIO · LIVE"
							: state === "silent"
								? "BACKGROUND MEDIA AUDIO · SILENT"
								: state === "unavailable"
									? "BACKGROUND AUDIO UNAVAILABLE"
									: "ADD A MUSIC VIDEO · ENABLE BACKGROUND SOUND"}
					</text>
				</g>
			) : null}
		</g>
	);
}

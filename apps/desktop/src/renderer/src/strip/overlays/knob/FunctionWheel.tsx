import { useEffect, useId, useRef, useState } from "react";
import type { MenuProfile } from "../../../../../shared/knob-contracts";

export function FunctionWheel({
	entries,
	index,
	direction,
}: {
	entries: readonly MenuProfile[];
	index: number;
	direction: -1 | 1;
}): React.JSX.Element {
	const root = useRef<HTMLDivElement>(null);
	const offset = useRef(0);
	const [angle, setAngle] = useState(0);
	const measured = document.createElement("canvas").getContext("2d");
	if (measured) measured.font = "40px Inter";
	const textWidth = Math.max(
		0,
		...[-1, 0, 1].map((delta) => {
			const name =
				entries[
					(((index + delta) % entries.length) + entries.length) % entries.length
				]?.name ?? "";
			return (measured?.measureText(name).width ?? 0) * (delta === 0 ? 1 : 0.7);
		}),
	);
	const vignetteWidth = textWidth > 240 ? textWidth + 400 : 480;
	const entryId = entries[index]?.id;
	useEffect(() => {
		if (!entryId) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const from = offset.current;
		const count = Math.min(5, entries.length);
		const to = count > 1 ? direction * (1.8 / (count - 1)) * 0.3 : 0;
		const started = performance.now();
		let frame = 0;
		const tick = (now: number) => {
			const k = Math.min(1, (now - started) / 200);
			const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
			offset.current = k === 1 ? 0 : from + (to - from) * eased;
			setAngle(offset.current);
			if (k < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [entryId, direction, entries.length]);
	const glow = `wheel-glow-${useId().replace(/[^\w-]/g, "")}`;
	return (
		<div
			ref={root}
			className="knob-wheel"
			role="img"
			data-testid="function-wheel"
			aria-label="Profile wheel"
		>
			<div
				className="knob-vignette"
				style={{ width: vignetteWidth, backgroundPosition: "right center" }}
			/>
			<svg
				className="knob-wheel-arc"
				width="165"
				height="480"
				viewBox="0 0 165 480"
				aria-hidden="true"
			>
				<defs>
					<filter id={glow} x="-100%" y="-100%" width="300%" height="300%">
						<feGaussianBlur stdDeviation="16" />
					</filter>
				</defs>
				<circle
					cx="425"
					cy="240"
					r="357.5"
					fill="none"
					stroke="#00ffc2"
					strokeWidth="7"
					opacity=".8"
					filter={`url(#${glow})`}
				/>
				<circle cx="425" cy="240" r="361" fill="#000" />
				<circle
					cx="425"
					cy="240"
					r="357.5"
					fill="none"
					stroke="#00ffff"
					strokeWidth="7"
				/>
			</svg>
			{[-2, -1, 0, 1, 2].map((offset) => {
				const entry =
					entries[
						(((index + offset) % entries.length) + entries.length) %
							entries.length
					];
				return (
					<div
						key={offset}
						className="knob-wheel-label"
						data-slot={offset + 2}
						style={{
							right:
								([102, 137, 153, 137, 110][offset + 2] ?? 153) +
								470 *
									0.405 *
									1.17 *
									(Math.cos(offset * 0.45 + angle) - Math.cos(offset * 0.45)),
							top:
								240 +
								(offset === -2
									? -166.81
									: offset === -1
										? -88.37
										: offset === 1
											? 88.37
											: offset === 2
												? 166.81
												: 0),
						}}
					>
						{entry?.name}
					</div>
				);
			})}
			<div
				key={`${index}-${direction}`}
				className="knob-wheel-direction"
				data-direction={direction}
			/>
		</div>
	);
}

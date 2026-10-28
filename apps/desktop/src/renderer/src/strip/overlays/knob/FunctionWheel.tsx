import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuProfile } from "../../../../../shared/knob-contracts";

// Rows spread over the full 480 px panel height, centred on the selection.
const ROW_OFFSETS = [-168, -88, 0, 88, 168] as const;
const CENTER = 240;

/** Recovered geometry and deadlines, using the independent flat list drawing. */
export function FunctionWheel({
	entries,
	index,
	direction,
	motion = "full",
}: {
	entries: readonly MenuProfile[];
	index: number;
	direction: -1 | 1;
	motion?: "full" | "reduce";
}): React.JSX.Element | null {
	const [nudge, setNudge] = useState(0);
	const [indicator, setIndicator] = useState(false);
	const [width, setWidth] = useState(440);
	const labels = useRef<HTMLDivElement>(null);
	const entryId = entries[index]?.id;
	useLayoutEffect(() => {
		const nodes =
			labels.current?.querySelectorAll<HTMLElement>(".knob-wheel-label");
		let widest = 0;
		for (const slot of [1, 2, 3]) {
			const node = nodes?.[slot];
			if (
				!node ||
				!entries[(index + slot - 1 + entries.length) % entries.length]
			)
				continue;
			// Measure text, not its clipped box. Cap before allocating the sheet.
			const range = document.createRange();
			range.selectNodeContents(node);
			const measured = range.getBoundingClientRect().width;
			widest = Math.max(
				widest,
				Math.min(600, measured) * (slot === 2 ? 1 : 0.7),
			);
		}
		setWidth(widest > 320 ? Math.min(560, widest + 120) : 440);
	}, [entries, index]);
	useEffect(() => {
		setNudge(0);
		setIndicator(false);
		if (
			!entryId ||
			motion === "reduce" ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		)
			return;
		setIndicator(true);
		const indicatorTimer = setTimeout(() => setIndicator(false), 300);
		const started = performance.now();
		const from = direction * 40;
		let frame = 0;
		const tick = (now: number) => {
			const k = Math.min(1, (now - started) / 200);
			const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
			setNudge(k === 1 ? 0 : from * (1 - eased));
			if (k < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(indicatorTimer);
		};
	}, [entryId, direction, motion]);
	return (
		<>
			<span role="status" aria-live="polite" className="visually-hidden">
				{entries[index]?.name}
			</span>
			<div className="knob-wheel-backdrop" style={{ width }} />
			<div
				className="knob-wheel"
				role="img"
				data-testid="function-wheel"
				aria-label="Profile wheel"
			>
				<div
					ref={labels}
					className="knob-wheel-list"
					style={{ transform: `translateY(${nudge}px)` }}
				>
					{[-2, -1, 0, 1, 2].map((delta) => {
						const entry =
							entries[
								(((index + delta) % entries.length) + entries.length) %
									entries.length
							];
						return (
							<div
								key={delta}
								className="knob-wheel-label"
								data-slot={delta + 2}
								style={{
									top: CENTER + (ROW_OFFSETS[delta + 2] ?? 0),
									width: Math.min(
										600,
										(width - 160) / (delta === 0 ? 1.404 : 1),
									),
								}}
								title={entry?.name}
							>
								{entry?.name}
							</div>
						);
					})}
				</div>
				{indicator ? (
					<div className="knob-wheel-direction" data-direction={direction} />
				) : null}
			</div>
		</>
	);
}

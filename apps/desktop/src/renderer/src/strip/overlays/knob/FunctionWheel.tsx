import { useEffect, useRef, useState } from "react";
import type { MenuProfile } from "../../../../../shared/knob-contracts";

/** Row offsets of the five visible entries; the centre one is the choice. */
const ROW_OFFSETS = [-176, -96, 0, 96, 176] as const;

/**
 * The ring selector as a right-edge list sheet: the chosen profile large
 * with an accent marker, two neighbours each side, a short nudge in the
 * knob's direction (knob-model "Strip selector presentation and touch",
 * drawn per independent-device-design).
 */
export function FunctionWheel({
	entries,
	index,
	direction,
}: {
	entries: readonly MenuProfile[];
	index: number;
	direction: -1 | 1;
}): React.JSX.Element {
	const offset = useRef(0);
	const [nudge, setNudge] = useState(0);
	const entryId = entries[index]?.id;
	useEffect(() => {
		if (!entryId) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const from = direction * 40;
		const started = performance.now();
		let frame = 0;
		const tick = (now: number) => {
			const k = Math.min(1, (now - started) / 200);
			const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
			offset.current = k === 1 ? 0 : from * (1 - eased);
			setNudge(offset.current);
			if (k < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [entryId, direction]);
	return (
		<div
			className="knob-wheel"
			role="img"
			data-testid="function-wheel"
			aria-label="Profile wheel"
		>
			<div
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
							style={{ top: 240 + (ROW_OFFSETS[delta + 2] ?? 0) }}
						>
							{entry?.name}
						</div>
					);
				})}
			</div>
			<div
				key={`${index}-${direction}`}
				className="knob-wheel-direction"
				data-direction={direction}
			/>
		</div>
	);
}

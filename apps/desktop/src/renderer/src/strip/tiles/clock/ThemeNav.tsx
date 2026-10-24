import { useEffect, useRef, useState } from "react";

/** DK-Suite's touch bridge marks a lifted finger that moved as ineffective. */
function isEffectiveTouch(event: Event): boolean {
	if (!(event instanceof CustomEvent)) return false;
	const detail: unknown = event.detail;
	return (
		typeof detail === "object" &&
		detail !== null &&
		"isEffective" in detail &&
		detail.isEffective === true
	);
}

/**
 * One glass ◀/▶ button. Press feedback is visual only; the action fires once,
 * on click (pointer, keyboard) or on an effective `quake-sub-touch-end` from
 * the strip's touch controller.
 */
function NavButton({
	direction,
	label,
	title,
	onCycle,
}: {
	direction: "prev" | "next";
	label: string;
	title: string;
	onCycle: () => void;
}): React.JSX.Element {
	const ref = useRef<HTMLButtonElement>(null);
	const [pressed, setPressed] = useState(false);
	const cycle = useRef(onCycle);
	cycle.current = onCycle;
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const start = (event: Event): void => {
			event.stopPropagation();
			setPressed(true);
		};
		const end = (event: Event): void => {
			event.stopPropagation();
			setPressed(false);
			if (isEffectiveTouch(event)) cycle.current();
		};
		element.addEventListener("quake-sub-touch-start", start);
		element.addEventListener("quake-sub-touch-end", end);
		return () => {
			element.removeEventListener("quake-sub-touch-start", start);
			element.removeEventListener("quake-sub-touch-end", end);
		};
	}, []);
	const release = (event: React.PointerEvent): void => {
		event.stopPropagation();
		setPressed(false);
	};
	return (
		<button
			ref={ref}
			type="button"
			className={`oq-clock-nav-btn${pressed ? " is-pressed" : ""}`}
			data-testid={`clock-theme-${direction}`}
			data-quake-sub-touch={`clock-theme-${direction}`}
			data-support-quake-move="false"
			aria-label={label}
			title={title}
			onPointerDown={(event) => {
				event.stopPropagation();
				setPressed(true);
			}}
			onPointerUp={release}
			onPointerCancel={release}
			onPointerLeave={release}
			onClick={(event) => {
				event.stopPropagation();
				onCycle();
			}}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d={direction === "prev" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
			</svg>
		</button>
	);
}

export function ThemeNav({
	name,
	previousLabel,
	nextLabel,
	onCycle,
}: {
	name: string;
	previousLabel: string;
	nextLabel: string;
	onCycle: (delta: 1 | -1) => void;
}): React.JSX.Element {
	return (
		<div className="oq-clock-nav" data-clock-theme-nav="">
			<NavButton
				direction="prev"
				label={previousLabel}
				title={name}
				onCycle={() => onCycle(-1)}
			/>
			<span className="oq-clock-nav-name" title={name}>
				{name}
			</span>
			<NavButton
				direction="next"
				label={nextLabel}
				title={name}
				onCycle={() => onCycle(1)}
			/>
		</div>
	);
}

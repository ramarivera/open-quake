import { type ReactNode, useCallback, useEffect, useRef } from "react";

export function TouchButton({
	id,
	label,
	children,
	onClick,
	onLongPress,
	pressed = false,
	disabled = false,
}: {
	id: string;
	label: string;
	children: ReactNode;
	onClick: () => void;
	onLongPress?: (() => void) | undefined;
	pressed?: boolean;
	disabled?: boolean;
}): React.JSX.Element {
	const element = useRef<HTMLButtonElement>(null);
	const current = useRef({ onClick, onLongPress, disabled });
	current.current = { onClick, onLongPress, disabled };
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const held = useRef(false);
	const start = useCallback(() => {
		held.current = false;
		clearTimeout(timer.current);
		if (current.current.onLongPress && !current.current.disabled)
			timer.current = setTimeout(() => {
				held.current = true;
				current.current.onLongPress?.();
			}, 1200);
	}, []);
	const end = useCallback(() => clearTimeout(timer.current), []);
	useEffect(() => {
		const target = element.current;
		if (!target) return;
		const finish = (event: Event) => {
			end();
			if (!(event instanceof CustomEvent)) return;
			const detail: unknown = event.detail;
			if (
				!held.current &&
				!current.current.disabled &&
				typeof detail === "object" &&
				detail !== null &&
				"isEffective" in detail &&
				detail.isEffective === true
			)
				current.current.onClick();
		};
		target.addEventListener("quake-sub-touch-start", start);
		target.addEventListener("quake-sub-touch-end", finish);
		return () => {
			end();
			target.removeEventListener("quake-sub-touch-start", start);
			target.removeEventListener("quake-sub-touch-end", finish);
		};
	}, [start, end]);
	return (
		<button
			ref={element}
			type="button"
			aria-label={label}
			title={label}
			aria-pressed={pressed}
			disabled={disabled}
			data-quake-sub-touch={id}
			data-support-quake-move="false"
			onPointerDown={start}
			onPointerUp={end}
			onPointerCancel={end}
			onPointerLeave={end}
			onClick={() => {
				if (!held.current) onClick();
			}}
		>
			{children}
		</button>
	);
}

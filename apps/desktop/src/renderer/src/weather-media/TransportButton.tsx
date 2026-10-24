import { type ReactNode, useEffect, useRef, useState } from "react";

export function TransportButton({
	id,
	label,
	disabled = false,
	onPress,
	children,
	className = "",
}: {
	id: string;
	label: string;
	disabled?: boolean;
	onPress: () => void;
	children: ReactNode;
	className?: string;
}): React.JSX.Element {
	const ref = useRef<HTMLButtonElement>(null);
	const action = useRef({ disabled, onPress });
	action.current = { disabled, onPress };
	const [pressed, setPressed] = useState(false);
	useEffect(() => {
		const button = ref.current;
		if (!button) return;
		const start = (event: Event) => {
			event.stopPropagation();
			if (!action.current.disabled) setPressed(true);
		};
		const end = (event: Event) => {
			event.stopPropagation();
			setPressed(false);
			const detail: unknown =
				event instanceof CustomEvent ? event.detail : null;
			if (
				!action.current.disabled &&
				typeof detail === "object" &&
				detail !== null &&
				"isEffective" in detail &&
				detail.isEffective === true
			)
				action.current.onPress();
		};
		button.addEventListener("quake-sub-touch-start", start);
		button.addEventListener("quake-sub-touch-end", end);
		return () => {
			button.removeEventListener("quake-sub-touch-start", start);
			button.removeEventListener("quake-sub-touch-end", end);
		};
	}, []);
	return (
		<button
			ref={ref}
			type="button"
			className={`${className}${pressed ? " is-pressed" : ""}`}
			disabled={disabled}
			data-quake-sub-touch={id}
			data-testid={id}
			data-support-quake-move="false"
			aria-label={label}
			onPointerDown={(event) => {
				event.stopPropagation();
				setPressed(true);
			}}
			onPointerUp={() => setPressed(false)}
			onPointerCancel={() => setPressed(false)}
			onPointerLeave={() => setPressed(false)}
			onClick={(event) => {
				event.stopPropagation();
				if (!disabled) onPress();
			}}
		>
			{children}
		</button>
	);
}

export function TransportGlyph({
	kind,
}: {
	kind: "play" | "pause" | "stop" | "previous" | "next";
}): React.JSX.Element {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			{kind === "play" ? (
				<path d="M7 3 21 12 7 21Z" />
			) : kind === "pause" ? (
				<>
					<rect x="5" y="4" width="5" height="16" rx="1" />
					<rect x="14" y="4" width="5" height="16" rx="1" />
				</>
			) : kind === "stop" ? (
				<rect x="5" y="5" width="14" height="14" rx="2" />
			) : kind === "previous" ? (
				<>
					<path d="M19 4 8 12 19 20Z" />
					<path d="M5 4V20" stroke="currentColor" strokeWidth="2" />
				</>
			) : (
				<>
					<path d="M5 4 16 12 5 20Z" />
					<path d="M19 4V20" stroke="currentColor" strokeWidth="2" />
				</>
			)}
		</svg>
	);
}

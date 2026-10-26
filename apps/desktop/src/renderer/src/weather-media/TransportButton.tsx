import { type ReactNode, useEffect, useRef } from "react";
import { mountTouchTarget } from "../strip/touch-gestures";

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
	useEffect(() => {
		const button = ref.current;
		if (!button) return;
		return mountTouchTarget(button, {
			tap: () => action.current.onPress(),
			disabled: () => action.current.disabled,
		});
	}, []);
	return (
		<button
			ref={ref}
			type="button"
			className={className}
			disabled={disabled}
			data-quake-sub-touch={id}
			data-testid={id}
			data-support-quake-move="false"
			aria-label={label}
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

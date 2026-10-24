/** 16px line icons drawn to match SF Symbols' regular weight. Decorative only. */

function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
	return (
		<svg
			className="icon"
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{children}
		</svg>
	);
}

export function DeviceIcon(): React.JSX.Element {
	return (
		<Icon>
			<rect x="1.5" y="4.5" width="13" height="7" rx="1.6" />
			<rect x="3.5" y="6.5" width="6" height="3" rx="0.6" />
			<circle cx="12" cy="8" r="1.2" />
		</Icon>
	);
}

export function ScreenIcon(): React.JSX.Element {
	return (
		<Icon>
			<rect x="1.5" y="3" width="13" height="10" rx="1.6" />
			<path d="m1.8 11 3.7-3.6 3 2.9 1.8-1.7 3.9 3.7" />
			<circle cx="10.8" cy="6" r="1" />
		</Icon>
	);
}

export function ConnectionIcon(): React.JSX.Element {
	return (
		<Icon>
			<path d="M5 1.5v3m6-3v3M3.5 4.5h9v2a4.5 4.5 0 0 1-9 0Zm4.5 6.5v3.5" />
		</Icon>
	);
}

export function AppearanceIcon(): React.JSX.Element {
	return (
		<Icon>
			<circle cx="8" cy="8" r="6.2" />
			<path
				d="M8 1.8a6.2 6.2 0 0 1 0 12.4Z"
				fill="currentColor"
				stroke="none"
			/>
		</Icon>
	);
}

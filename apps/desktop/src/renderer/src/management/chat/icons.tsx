const paths = {
	plus: "M12 5v14M5 12h14",
	send: "M5 12h13M13 6l6 6-6 6",
	stop: "M7 7h10v10H7z",
	settings:
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z",
	trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
	refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
	chevron: "M9 6l6 6-6 6",
	plug: "M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4",
} as const;

/** Decorative stroke icons; every button keeps a visible or accessible text label. */
export function Icon({ name }: { readonly name: keyof typeof paths }) {
	return (
		<svg
			className="cw-icon"
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d={paths[name]} />
		</svg>
	);
}

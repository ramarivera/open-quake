export function MeetingGlyph({
	kind,
}: {
	kind: "mic" | "mute" | "record" | "mark" | "translate";
}): React.JSX.Element {
	const paths = {
		mic: "M12 16a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v6a4 4 0 0 0 4 4ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
		mute: "m3 3 18 18M8 8v4a4 4 0 0 0 7 2M16 10V6a4 4 0 0 0-7-2M5 11v1a7 7 0 0 0 12 5M12 19v3M8 22h8",
		record: "M5 5h14v14H5ZM9 9h6v6H9Z",
		mark: "M6 3h12v19l-6-4-6 4Z",
		translate:
			"M3 5h12M9 2v3M5 8c2 5 5 7 9 9M13 5c-1 6-5 10-10 12M14 22l4-11 4 11M16 18h4",
	};
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			<path d={paths[kind]} />
		</svg>
	);
}

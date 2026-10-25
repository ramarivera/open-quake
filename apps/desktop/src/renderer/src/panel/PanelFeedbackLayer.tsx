import {
	DETENT_DEGREES,
	formatDetents,
	type PanelFeedbackView,
	type PanelLink,
} from "./panelFeedback";
import "./panel.css";

/** Logical-canvas geometry. The knob sits flush right, clear of the clock. */
const KNOB = { cx: 1672, cy: 240, body: 168, cap: 106 } as const;
const TRACK = 136;
const HOME = { inner: 112, outer: 124 } as const;
/** Labels synthetic input; an opaque chip keeps it legible over any image. */
const SOURCE_CHIP = {
	x: KNOB.cx - KNOB.body - 28 - 236,
	y: KNOB.cy - 32,
	width: 236,
	height: 64,
} as const;
const PLATE = { x: 1192, y: 128, width: 648, height: 224 } as const;

function valueSize(text: string): number {
	return text.length <= 2
		? 104
		: text.length === 3
			? 88
			: text.length === 4
				? 70
				: 56;
}

function Knob({ view }: { view: PanelFeedbackView }): React.JSX.Element {
	const angle = view.detents * DETENT_DEGREES;
	const value = formatDetents(view.detents);
	const size = valueSize(value);
	return (
		<g
			className="panel-knob"
			data-visible={view.knobVisible}
			data-pressed={view.pressed}
		>
			<g className="panel-knob-face">
				<circle
					cx={KNOB.cx}
					cy={KNOB.cy}
					r={KNOB.body}
					className="panel-knob-body"
				/>
				<circle
					cx={KNOB.cx}
					cy={KNOB.cy}
					r={TRACK}
					className="panel-knob-track"
				/>
				<line
					x1={KNOB.cx}
					y1={KNOB.cy - HOME.inner}
					x2={KNOB.cx}
					y2={KNOB.cy - HOME.outer}
					className="panel-knob-home"
				/>
				<g
					className="panel-knob-pointer"
					style={{
						transform: `rotate(${angle}deg)`,
						transformOrigin: `${KNOB.cx}px ${KNOB.cy}px`,
					}}
				>
					<circle cx={KNOB.cx} cy={KNOB.cy - TRACK} r="16" />
				</g>
				<text
					x={KNOB.cx}
					y={KNOB.cy + size * 0.36}
					className="panel-knob-value"
					style={{ fontSize: size }}
				>
					{value}
				</text>
			</g>
			{view.mock ? (
				<g className="panel-knob-source">
					<rect {...SOURCE_CHIP} rx={SOURCE_CHIP.height / 2} />
					<text x={SOURCE_CHIP.x + SOURCE_CHIP.width / 2} y={KNOB.cy + 13}>
						Mock input
					</text>
				</g>
			) : null}
		</g>
	);
}

function OfflinePlate({
	link,
}: {
	link: Extract<PanelLink, { state: "offline" }>;
}): React.JSX.Element {
	const iconX = PLATE.x + 84;
	const textX = PLATE.x + 148;
	const top = link.code ? PLATE.y + 82 : PLATE.y + 96;
	return (
		<g className="panel-offline" data-code={link.code ?? undefined}>
			<rect {...PLATE} rx="24" className="panel-offline-plate" />
			<rect
				x={PLATE.x}
				y={PLATE.y + 24}
				width="6"
				height={PLATE.height - 48}
				className="panel-offline-rule"
			/>
			<circle
				cx={iconX}
				cy={PLATE.y + PLATE.height / 2}
				r="30"
				className="panel-offline-icon"
			/>
			<line
				x1={iconX - 21}
				y1={PLATE.y + PLATE.height / 2 + 21}
				x2={iconX + 21}
				y2={PLATE.y + PLATE.height / 2 - 21}
				className="panel-offline-icon"
			/>
			<text x={textX} y={top} className="panel-offline-title">
				Controls offline
			</text>
			<text x={textX} y={top + 52} className="panel-offline-detail">
				{link.detail}
			</text>
			{link.code ? (
				<text x={textX} y={top + 98} className="panel-offline-code">
					{link.code}
				</text>
			) : null}
		</g>
	);
}

/**
 * Live input feedback drawn inside the shared wallpaper canvas, so it uses
 * the same 1920 × 480 coordinates. Only the device panel renders it.
 */
export function PanelFeedbackLayer({
	view,
}: {
	view: PanelFeedbackView;
}): React.JSX.Element {
	return (
		<g className="panel-feedback">
			{view.link.state === "offline" ? (
				<OfflinePlate link={view.link} />
			) : (
				<Knob view={view} />
			)}
			{view.touches.map((touch) => (
				<g key={touch.id} className="panel-touch">
					<circle
						cx={touch.x}
						cy={touch.y}
						r="48"
						className="panel-touch-ring"
					/>
					<circle cx={touch.x} cy={touch.y} r="8" className="panel-touch-dot" />
				</g>
			))}
		</g>
	);
}

import { normalizeTouch } from "../strip/touch-geometry";
import {
	DETENT_DEGREES,
	formatDetents,
	type PanelFeedbackView,
	type PanelLink,
} from "./panelFeedback";
import "./panel.css";

/** Readable dial: an opaque disc that briefly covers the tiles behind it. */
const KNOB = { cx: 1672, cy: 240, body: 76 } as const;
const TRACK = 62;
const POINTER = 8;
const HOME = { inner: 54, outer: 70 } as const;
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
		? 52
		: text.length === 3
			? 44
			: text.length === 4
				? 36
				: 28;
}

/** Accent arc from the home mark to the current angle, capped below a full turn. */
function arcPath(angle: number): string | undefined {
	const a = Math.max(-359, Math.min(359, angle));
	if (a === 0) return undefined;
	const rad = (a * Math.PI) / 180;
	const x = KNOB.cx + TRACK * Math.sin(rad);
	const y = KNOB.cy - TRACK * Math.cos(rad);
	const large = Math.abs(a) > 180 ? 1 : 0;
	const sweep = a > 0 ? 1 : 0;
	return `M ${KNOB.cx} ${KNOB.cy - TRACK} A ${TRACK} ${TRACK} 0 ${large} ${sweep} ${x} ${y}`;
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
				{arcPath(angle) ? (
					<path d={arcPath(angle)} className="panel-knob-arc" />
				) : null}
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
					<circle cx={KNOB.cx} cy={KNOB.cy - TRACK} r={POINTER} />
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
	inputDiagnostics = false,
	rotation = 0,
}: {
	view: PanelFeedbackView;
	inputDiagnostics?: boolean;
	rotation?: number;
}): React.JSX.Element {
	return (
		<g className="panel-feedback">
			{view.link.state === "offline" ? (
				<OfflinePlate link={view.link} />
			) : inputDiagnostics ? (
				<Knob view={view} />
			) : null}
			{inputDiagnostics
				? view.touches.map((raw) => {
						const touch = {
							...raw,
							...normalizeTouch(raw, { width: 1920, height: 480, rotation }),
						};
						return (
							<g key={touch.id} className="panel-touch">
								<circle
									cx={touch.x}
									cy={touch.y}
									r="48"
									className="panel-touch-ring"
								/>
								<circle
									cx={touch.x}
									cy={touch.y}
									r="8"
									className="panel-touch-dot"
								/>
							</g>
						);
					})
				: null}
		</g>
	);
}

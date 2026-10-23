import { useEffect, useState } from "react";
import { ThemeSettings } from "./theme/ThemeSettings";
import {
	type AppearanceController,
	useAppearance,
} from "./theme/useAppearance";
import { useQuakeEvents } from "./useQuakeEvents";
import "./styles.css";

function useSurface(): "management" | "panel" {
	const [surface] = useState<"management" | "panel">(() =>
		new URLSearchParams(window.location.search).get("surface") === "panel"
			? "panel"
			: "management",
	);
	return surface;
}

function PanelSurface(): React.JSX.Element {
	const { rotations, presses, lastKeepAliveSeq, touchPoints } =
		useQuakeEvents();
	const alive = lastKeepAliveSeq !== null;
	useEffect(() => {
		// Keep the OmniWM titleSubstring float rule matching this window.
		document.title = "open-quake panel";
	}, []);
	return (
		<main className="panel" aria-label="Quake device panel">
			<Stat label="ROTATIONS" value={rotations} animate />
			<Stat label="PRESSES" value={presses} animate />
			<Stat
				label="KEEP-ALIVE"
				value={alive ? `#${lastKeepAliveSeq}` : "waiting"}
				tone={alive ? "success" : "warning"}
			/>
			<Stat
				label="TOUCH"
				value={touchPoints.length ? `${touchPoints.length} pt` : "—"}
				animate
			/>
			<span className="panel-source muted">mock device source</span>
		</main>
	);
}

function Stat({
	label,
	value,
	tone,
	animate = false,
}: {
	label: string;
	value: string | number;
	tone?: "success" | "warning";
	animate?: boolean;
}): React.JSX.Element {
	return (
		<div className="stat">
			<div className="stat-label">{label}</div>
			<div className="stat-value" data-tone={tone}>
				<span key={value} className={animate ? "stat-change" : undefined}>
					{value}
				</span>
			</div>
		</div>
	);
}

function ManagementSurface({
	appearance,
}: {
	appearance: AppearanceController;
}): React.JSX.Element {
	const { eventsReceived, rotations, presses, lastKeepAliveSeq } =
		useQuakeEvents();
	return (
		<main className="management">
			<h1>open-quake management</h1>
			<p className="muted">
				Prototype: panel window + mock device bus are live.
			</p>
			<section className="diagnostics" aria-label="Mock device diagnostics">
				<Stat label="EVENTS RECEIVED" value={eventsReceived} />
				<Stat label="ROTATIONS" value={rotations} animate />
				<Stat label="PRESSES" value={presses} animate />
				<Stat label="KEEP-ALIVE" value={lastKeepAliveSeq ?? "—"} />
			</section>
			<p className="muted">
				The panel window owns the DK-QUAKE display, or a fallback window when
				the panel is unplugged.
			</p>
			<ThemeSettings controller={appearance} />
		</main>
	);
}

export function App(): React.JSX.Element {
	const surface = useSurface();
	const appearance = useAppearance();
	return surface === "panel" ? (
		<PanelSurface />
	) : (
		<ManagementSurface appearance={appearance} />
	);
}

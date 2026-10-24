import { useEffect, useState } from "react";
import { ConnectionCheck } from "./ConnectionDiagnostic";
import { ThemeSettings } from "./theme/ThemeSettings";
import {
	type AppearanceController,
	useAppearance,
} from "./theme/useAppearance";
import { useQuakeEvents } from "./useQuakeEvents";
import { WallpaperPanel, WallpaperSettings } from "./wallpaper/WallpaperViews";
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
	useEffect(() => {
		// Keep the OmniWM titleSubstring float rule matching this window.
		document.title = "open-quake panel";
	}, []);
	return <WallpaperPanel />;
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
	const [deviceReady, setDeviceReady] = useState(false);
	const { eventsReceived, rotations, presses, lastKeepAliveSeq } =
		useQuakeEvents();
	return (
		<main className="management">
			<h1>open-quake management</h1>
			<p className="muted">Manage your QUAKE connection and desktop preview.</p>
			<ConnectionCheck onReady={setDeviceReady} />
			<section className="diagnostics" aria-label="Device input diagnostics">
				<Stat label="EVENTS RECEIVED" value={eventsReceived} />
				<Stat label="ROTATIONS" value={rotations} animate />
				<Stat label="PRESSES" value={presses} animate />
				<Stat label="KEEP-ALIVE" value={lastKeepAliveSeq ?? "—"} />
			</section>
			<p className="muted">
				The panel follows the QUAKE display. Development builds also offer a
				desktop preview when the strip is unplugged.
			</p>
			<section
				aria-label={deviceReady ? "Device settings" : "Desktop preview"}
				data-session={deviceReady ? "device" : "preview"}
			>
				<h2>{deviceReady ? "Device settings" : "Desktop preview"}</h2>
				<ThemeSettings controller={appearance} />
				<WallpaperSettings />
			</section>
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

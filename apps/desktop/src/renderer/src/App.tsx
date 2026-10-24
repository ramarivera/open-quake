import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionCheck } from "./ConnectionDiagnostic";
import { HardwareSettings } from "./hardware/HardwareSettings";
import { describeConnection } from "./management/connection";
import { OverviewPage } from "./management/OverviewPage";
import { CaptureHost } from "./meetings/CaptureHost";
import { MeetingHistory } from "./meetings/MeetingHistory";
import { StripPanel } from "./strip/StripPanel";
import { ClockSettings } from "./strip/tiles/clock/ClockSettings";
import { MonitorSettings } from "./strip/tiles/monitor/MonitorSettings";
import { ThemeSettings } from "./theme/ThemeSettings";
import {
	type AppearanceController,
	useAppearance,
} from "./theme/useAppearance";
import { StatusDot } from "./ui/Form";
import {
	AppearanceIcon,
	ConnectionIcon,
	ControlsIcon,
	DeviceIcon,
	ScreenIcon,
} from "./ui/icons";
import { useQuakeEvents } from "./useQuakeEvents";
import { useWallpaper } from "./wallpaper/useWallpaper";
import { WallpaperSettings } from "./wallpaper/WallpaperViews";
import "./styles.css";
import "./management/management.css";
import { ProfilesManager, ProfileThumbnail } from "./profiles/ProfileViews";

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
	return <StripPanel />;
}

type Page =
	| "overview"
	| "profiles"
	| "connection"
	| "screen"
	| "controls"
	| "appearance"
	| "meetings";

type NavItem = {
	readonly id: Page;
	readonly label: string;
	readonly Icon: () => React.JSX.Element;
};

// Device areas (keys, knob, lighting, assistant) join the first section as
// they get wired; app-wide preferences stay in the second.
const sections: ReadonlyArray<{
	readonly title: string;
	readonly items: ReadonlyArray<NavItem>;
}> = [
	{
		title: "Device",
		items: [
			{ id: "overview", label: "Overview", Icon: DeviceIcon },
			{ id: "profiles", label: "Knob Profile", Icon: DeviceIcon },
			{ id: "connection", label: "Connection", Icon: ConnectionIcon },
			{ id: "screen", label: "Screen", Icon: ScreenIcon },
			{ id: "controls", label: "Controls", Icon: ControlsIcon },
		],
	},
	{
		title: "App",
		items: [
			{ id: "meetings", label: "Meeting", Icon: DeviceIcon },
			{ id: "appearance", label: "Appearance", Icon: AppearanceIcon },
		],
	},
];

function ManagementSurface({
	appearance,
}: {
	appearance: AppearanceController;
}): React.JSX.Element {
	const quake = useQuakeEvents();
	// One wallpaper subscription feeds both the overview preview and the editor.
	const wallpaper = useWallpaper();
	const [page, setPage] = useState<Page>(
		new URLSearchParams(window.location.search).get("page") === "meetings"
			? "meetings"
			: "overview",
	);
	const [deviceReady, setDeviceReady] = useState(false);
	const wasReady = useRef(false);
	const onReady = useCallback((ready: boolean): void => {
		setDeviceReady(ready);
		if (ready)
			setPage((current) => (current === "connection" ? "screen" : current));
		else if (wasReady.current)
			setPage((current) => (current === "screen" ? "connection" : current));
		wasReady.current = ready;
	}, []);
	const content = useRef<HTMLElement>(null);
	const bridge = window.openQuake;
	const connection = describeConnection(quake.connection, bridge !== undefined);
	const open = (next: Page): void => {
		setPage(next);
		content.current?.scrollTo({ top: 0 });
	};
	return (
		<div className="app-shell">
			<aside className="sidebar">
				<div className="sidebar-device" data-tone={connection.tone}>
					<span className="sidebar-device-glyph">
						<DeviceIcon />
						<StatusDot tone={connection.tone} />
					</span>
					<span className="sidebar-device-text">
						<span className="sidebar-device-name">QUAKE</span>
						{/* Announces connection changes from any page. */}
						<span className="sidebar-device-status" role="status">
							{connection.label}
						</span>
					</span>
				</div>
				<nav className="nav" aria-label="Sections">
					{sections.map((section) => (
						<div key={section.title} className="nav-section">
							<h2 className="nav-heading">{section.title}</h2>
							<ul className="nav-list">
								{section.items.map(({ id, label, Icon }) => (
									<li key={id}>
										<button
											type="button"
											className="nav-item"
											aria-current={page === id ? "page" : undefined}
											title={label}
											onClick={() => open(id)}
										>
											<Icon />
											<span className="nav-label">{label}</span>
										</button>
									</li>
								))}
							</ul>
						</div>
					))}
				</nav>
				<p className="sidebar-footer">
					open-quake{bridge ? ` ${bridge.version}` : ""}
				</p>
			</aside>
			<main
				className="content"
				ref={content}
				data-session={deviceReady ? "device" : "preview"}
			>
				<div className="content-inner" data-page={page}>
					{/* Keep the diagnostic subscription alive while navigating pages. */}
					<div hidden={page !== "connection"}>
						<ConnectionCheck onReady={onReady} />
					</div>
					{page === "overview" ? (
						<OverviewPage
							quake={quake}
							connection={connection}
							snapshot={wallpaper.snapshot}
							onOpenScreen={() => open("screen")}
							onOpenConnection={() => open("connection")}
						/>
					) : page === "profiles" ? (
						<ProfilesManager />
					) : page === "screen" ? (
						<>
							<WallpaperSettings wallpaper={wallpaper} />
							<ClockSettings
								hourFormat={
									wallpaper.snapshot?.saved.clock.actions[0].value ?? "24h"
								}
							/>
							<MonitorSettings />
						</>
					) : page === "meetings" ? (
						<MeetingHistory />
					) : page === "controls" ? (
						<HardwareSettings />
					) : page === "appearance" ? (
						<ThemeSettings controller={appearance} />
					) : null}
				</div>
			</main>
		</div>
	);
}

export function App(): React.JSX.Element {
	if (
		new URLSearchParams(window.location.search).get("surface") ===
		"meeting-capture"
	)
		return <CaptureHost />;
	return <MainApp />;
}
function MainApp(): React.JSX.Element {
	const surface = useSurface();
	const appearance = useAppearance();
	if (
		new URLSearchParams(location.search).get("surface") === "profile-thumbnail"
	)
		return <ProfileThumbnail />;
	return surface === "panel" ? (
		<PanelSurface />
	) : (
		<ManagementSurface appearance={appearance} />
	);
}

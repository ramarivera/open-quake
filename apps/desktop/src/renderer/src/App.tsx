import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionCheck } from "./ConnectionDiagnostic";
import { HardwareSettings } from "./hardware/HardwareSettings";
import { KeyEditor } from "./keys/KeyEditor";
import {
	AppUpdateDialog,
	FirmwareDialog,
	SettingsPage,
} from "./maintenance/SettingsPage";
import { useMaintenance } from "./maintenance/useMaintenance";
import { AgentsPage } from "./management/agents";
import { runtimeStatusLabel } from "./management/agents/RuntimeIndicator";
import { useAgents } from "./management/agents/useAgents";
import { describeConnection } from "./management/connection";
import { EmojiPage } from "./management/emoji/EmojiPage";
import { ChannelsPage } from "./management/integrations/ChannelsPage";
import { HomeAssistantPage } from "./management/integrations/HomeAssistantPage";
import { ShortcutsPage } from "./management/integrations/ShortcutsPage";
import {
	type ManagementPage,
	managementActivation,
} from "./management/navigation";
import { OverviewPage } from "./management/OverviewPage";
import { UiSettings } from "./management/UiSettings";
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
	AgentIcon,
	AppearanceIcon,
	ConnectionIcon,
	ControlsIcon,
	DeviceIcon,
	EmojiIcon,
	HomeIcon,
	ScreenIcon,
	ShortcutIcon,
} from "./ui/icons";
import { useQuakeEvents } from "./useQuakeEvents";
import { useWallpaper } from "./wallpaper/useWallpaper";
import { WallpaperSettings } from "./wallpaper/WallpaperViews";
import { WeatherMediaSettings } from "./weather-media/WeatherMediaSettings";
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

type Page = ManagementPage;

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
			{ id: "keys", label: "Keys", Icon: ControlsIcon },
			{ id: "connection", label: "Connection", Icon: ConnectionIcon },
			{ id: "screen", label: "Screen", Icon: ScreenIcon },
			{ id: "controls", label: "Controls", Icon: ControlsIcon },
		],
	},
	{
		title: "Core",
		items: [{ id: "agents", label: "OpenClaw", Icon: AgentIcon }],
	},
	{
		title: "Apps",
		items: [
			{ id: "emoji", label: "AI Emoji", Icon: EmojiIcon },
			{ id: "shortcuts", label: "AI shortcuts", Icon: ShortcutIcon },
			{ id: "home-assistant", label: "Home Assistant", Icon: HomeIcon },
		],
	},
	{
		title: "App",
		items: [
			{ id: "meetings", label: "Meeting", Icon: DeviceIcon },
			{ id: "appearance", label: "Appearance", Icon: AppearanceIcon },
			{ id: "settings", label: "Settings", Icon: ControlsIcon },
		],
	},
];

function ManagementSurface({
	appearance,
}: {
	appearance: AppearanceController;
}): React.JSX.Element {
	const quake = useQuakeEvents();
	const { view: agentView, error: agentError } = useAgents(window.quakeAgents);
	const runtime = agentView?.runtime;
	const runtimeLabel = runtime
		? runtimeStatusLabel(runtime)
		: agentError
			? "Agent runtime status unavailable"
			: "Checking agent runtime";
	const maintenance = useMaintenance();
	// One wallpaper subscription feeds both the overview preview and the editor.
	const wallpaper = useWallpaper();
	const [initialActivation] = useState(() => {
		const query = new URLSearchParams(location.search);
		// activeTab owns precedence, including an unknown value. page is the legacy fallback.
		return managementActivation(
			query.get("activeTab") ?? query.get("page") ?? "overview",
		);
	});
	const [agentActivation, setAgentActivation] = useState(() => ({
		tab: initialActivation?.agentTab ?? "sessions",
		sequence: 0,
	}));
	const sidebarDrag = useRef<{
		pointer: number;
		startX: number;
		startWidth: number;
	} | null>(null);
	const [page, setPage] = useState<Page>(() => {
		const active = initialActivation;
		return (
			sections.flatMap((s) => s.items).find((item) => item.id === active?.page)
				?.id ?? "overview"
		);
	});
	useEffect(
		() =>
			window.quakeManagement?.onActivate((name) => {
				const next = managementActivation(name);
				const item = sections
					.flatMap((s) => s.items)
					.find((item) => item.id === next?.page);
				if (item) {
					setPage(item.id);
					if (next?.agentTab) {
						const tab = next.agentTab;
						setAgentActivation((previous) => ({
							tab,
							sequence: previous.sequence + 1,
						}));
					}
					content.current?.scrollTo({ top: 0 });
				} else {
					console.warn("Unknown Management Center tab activation ignored");
				}
			}),
		[],
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
		<div
			className="management-window"
			data-platform={window.quakeManagement?.platform ?? "web"}
		>
			<div className="mc-titlebar">
				<span>open-quake</span>
				<span>Management Center</span>
			</div>
			<div className="app-shell">
				<aside className="sidebar">
					<div className="mc-product-mark">
						<span className="mc-product-icon">
							<ControlsIcon />
							<span
								className="mc-runtime-dot"
								data-runtime={runtime?.status ?? "unknown"}
								role="status"
								aria-label={runtimeLabel}
								title={runtimeLabel}
							/>
						</span>
						<strong>Quake AI Workspace</strong>
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
					<footer className="mc-sidebar-footer">
						{" "}
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
						<UiSettings controller={appearance} />
					</footer>
				</aside>
				<hr
					className="mc-resizer"
					tabIndex={0}
					aria-label="Drag to resize sidebar"
					aria-orientation="vertical"
					aria-valuemin={120}
					aria-valuemax={360}
					aria-valuenow={appearance.appearance.sidebarWidth ?? 218}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
							event.preventDefault();
							appearance.setSidebarWidth(
								(appearance.appearance.sidebarWidth ?? 218) +
									(event.key === "ArrowRight" ? 8 : -8),
							);
						}
					}}
					onPointerDown={(event) => {
						if (event.button !== 0) return;
						const target = event.currentTarget;
						sidebarDrag.current = {
							pointer: event.pointerId,
							startX: event.clientX,
							startWidth: appearance.appearance.sidebarWidth ?? 218,
						};
						target.setPointerCapture(event.pointerId);
						document.body.dataset.resizing = "true";
					}}
					onPointerMove={(event) => {
						if (
							sidebarDrag.current?.pointer === event.pointerId &&
							event.currentTarget.hasPointerCapture(event.pointerId)
						) {
							const width = Math.max(
								120,
								Math.min(
									360,
									sidebarDrag.current.startWidth +
										event.clientX -
										sidebarDrag.current.startX,
								),
							);
							document.documentElement.style.setProperty(
								"--mc-sidebar-width",
								`${width}px`,
							);
							event.currentTarget.setAttribute("aria-valuenow", String(width));
						}
					}}
					onPointerUp={(event) => {
						if (sidebarDrag.current?.pointer !== event.pointerId) return;
						const { startX, startWidth } = sidebarDrag.current;
						const width = Math.max(
							120,
							Math.min(360, startWidth + event.clientX - startX),
						);
						sidebarDrag.current = null;
						if (width !== startWidth) appearance.setSidebarWidth(width);
						event.currentTarget.releasePointerCapture(event.pointerId);
						delete document.body.dataset.resizing;
					}}
					onLostPointerCapture={(event) => {
						if (sidebarDrag.current) {
							sidebarDrag.current = null;
							const width = appearance.appearance.sidebarWidth ?? 218;
							document.documentElement.style.setProperty(
								"--mc-sidebar-width",
								`${width}px`,
							);
							event.currentTarget.setAttribute("aria-valuenow", String(width));
						}
						delete document.body.dataset.resizing;
					}}
				/>
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
						) : page === "keys" ? (
							<KeyEditor />
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
								<WeatherMediaSettings />
								<MonitorSettings />
							</>
						) : page === "meetings" ? (
							<MeetingHistory />
						) : page === "controls" ? (
							<HardwareSettings />
						) : page === "agents" ? (
							<AgentsPage
								initialTab={agentActivation.tab}
								activation={agentActivation}
							>
								<ChannelsPage />
							</AgentsPage>
						) : page === "emoji" ? (
							<EmojiPage />
						) : page === "shortcuts" ? (
							<ShortcutsPage />
						) : page === "home-assistant" ? (
							<HomeAssistantPage />
						) : page === "settings" ? (
							<SettingsPage controller={maintenance} />
						) : page === "appearance" ? (
							<ThemeSettings controller={appearance} />
						) : null}
					</div>
				</main>
			</div>
			<FirmwareDialog controller={maintenance} />
			<AppUpdateDialog controller={maintenance} />
			{maintenance.toast ? (
				<div role="status" className="maintenance-toast">
					{maintenance.toast}
				</div>
			) : null}
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

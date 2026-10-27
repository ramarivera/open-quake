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
import { DevicePicker } from "./management/DevicePicker";
import { EmojiPage } from "./management/emoji/EmojiPage";
import { ChannelsPage } from "./management/integrations/ChannelsPage";
import { HomeAssistantPage } from "./management/integrations/HomeAssistantPage";
import { ShortcutsPage } from "./management/integrations/ShortcutsPage";
import { ManagementShell } from "./management/ManagementShell";
import {
	type ManagementPage,
	managementActivation,
	pages,
} from "./management/navigation";
import { OverviewPage } from "./management/OverviewPage";
import { CaptureHost } from "./meetings/CaptureHost";
import { MeetingHistory } from "./meetings/MeetingHistory";
import { StripPanel } from "./strip/StripPanel";
import { ScreenClockSettings } from "./strip/tiles/clock/ClockSettings";
import { MonitorSettings } from "./strip/tiles/monitor/MonitorSettings";
import { ThemeSettings } from "./theme/ThemeSettings";
import {
	type AppearanceController,
	useAppearance,
} from "./theme/useAppearance";
import { useQuakeEvents } from "./useQuakeEvents";
import { useWallpaper } from "./wallpaper/useWallpaper";
import { WallpaperSettings } from "./wallpaper/WallpaperViews";
import "./styles.css";
import { IconPickerSurface } from "./keys/IconPicker";
import "./management/management.css";
import { useAppTranslations } from "./i18n";
import { ProfilesManager, ProfileThumbnail } from "./profiles/ProfileViews";
import { settingsBridge } from "./settings/bridge";
import { GeneralSettings } from "./settings/GeneralSettings";
import { InstallationGuide } from "./settings/InstallationGuide";
import { SetupResumeEntry, SetupWizard } from "./settings/SetupWizard";
import { createSetupLaunch } from "./settings/setup-launch";
import { useRuntimeChoice } from "./settings/setup-owners";
import { createSetupStore } from "./settings/stores";

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

type Page = ManagementPage | "setup";

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
	const settingsT = useAppTranslations("settings");
	const [setup] = useState(() => createSetupStore(settingsBridge()));
	const runtimeOption = useRuntimeChoice();
	const [setupLaunch] = useState(() =>
		createSetupLaunch(
			localStorage,
			window.quakeSettings?.development === true,
			window.quakeSettings?.wizardDebug === true,
		),
	);
	const [setupLaunchError, setSetupLaunchError] = useState("");
	// Any explicit activation or navigation wins over first-run setup.
	const navigated = useRef(
		((query) => query.has("activeTab") || query.has("page"))(
			new URLSearchParams(location.search),
		),
	);
	const [agentActivation, setAgentActivation] = useState(() => ({
		tab: initialActivation?.agentTab ?? "sessions",
		sequence: 0,
	}));
	const [meetingActivation, setMeetingActivation] = useState(0);
	const [page, setPage] = useState<Page>(() => {
		const active = initialActivation;
		return pages.find((id) => id === active?.page) ?? "overview";
	});
	useEffect(() => {
		const activate = (name: string) => {
			const next = managementActivation(name);
			const item = pages.find((id) => id === next?.page);
			if (item) {
				navigated.current = true;
				setPage(item);
				if (
					item === "keys" &&
					document.activeElement?.closest(".profiles-manager")
				)
					setGuideDestination(item);
				if (item === "meetings")
					setMeetingActivation((sequence) => sequence + 1);
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
		};
		const off = window.quakeManagement?.onActivate(activate);
		const navigate = (event: Event) => {
			if (event instanceof CustomEvent && typeof event.detail === "string")
				activate(event.detail);
		};
		window.addEventListener("open-quake:navigate", navigate);
		return () => {
			off?.();
			window.removeEventListener("open-quake:navigate", navigate);
		};
	}, []);
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
	const [guideDestination, setGuideDestination] =
		useState<ManagementPage | null>(null);
	useEffect(() => {
		if (guideDestination !== page) return;
		setGuideDestination(null);
		// Pages can replace their loading heading after async reads. The stable
		// content container keeps keyboard focus through that replacement.
		if (content.current) {
			content.current.tabIndex = -1;
			content.current.focus({ preventScroll: true });
		}
	}, [guideDestination, page]);
	const bridge = window.openQuake;
	const connection = describeConnection(quake.connection, bridge !== undefined);
	useEffect(() => {
		let live = true;
		void setup.load().then(async (ok) => {
			const snapshot = setup.getState().snapshot;
			if (!live || !ok || !snapshot || navigated.current) return;
			try {
				if (!setupLaunch.admit(snapshot, navigated.current)) return;
				if (snapshot.completed && !(await setup.replay())) return;
				if (live && !navigated.current) setPage("setup");
			} catch {
				setSetupLaunchError(
					"First-run state could not be saved. Open setup from Settings to continue.",
				);
			}
		});
		return () => {
			live = false;
		};
	}, [setup, setupLaunch]);
	const open = (next: Page): void => {
		navigated.current = true;
		setPage(next);
		if (next === "meetings") setMeetingActivation((sequence) => sequence + 1);
		content.current?.scrollTo({ top: 0 });
	};
	return (
		<>
			<ManagementShell
				page={page}
				onOpen={open}
				connection={connection}
				runtimeStatus={
					runtime
						? runtime.available
							? runtime.status
							: "unavailable"
						: "unknown"
				}
				runtimeLabel={runtimeLabel}
				runtimeSummary={
					runtime && !runtime.available
						? "Local runtime not installed"
						: runtimeLabel
				}
				appearance={appearance}
				contentRef={content}
				deviceReady={deviceReady}
				setupLabel={settingsT("setup.title")}
				setupEntry={(navigate) => (
					<SetupResumeEntry
						store={setup}
						runtime={runtimeOption}
						current={page === "setup"}
						onOpen={() => navigate("setup")}
					/>
				)}
			>
				{setupLaunchError ? <p role="alert">{setupLaunchError}</p> : null}
				{/* Keep the diagnostic subscription alive while navigating pages. */}
				<div hidden={page !== "connection"}>
					<ConnectionCheck onReady={onReady} />
				</div>
				{page === "overview" ? (
					<>
						<OverviewPage
							quake={quake}
							connection={connection}
							snapshot={wallpaper.snapshot}
							onOpenScreen={() => open("screen")}
							onOpenConnection={() => open("connection")}
						/>
						<div className="button-row setup-entrance-guide">
							<InstallationGuide />
						</div>
					</>
				) : page === "keys" ? (
					<KeyEditor onOpenLibrary={setPage} />
				) : page === "profiles" ? (
					<ProfilesManager />
				) : page === "screen" ? (
					<>
						<WallpaperSettings wallpaper={wallpaper} />
						<ScreenClockSettings serial={wallpaper.snapshot?.saved.serial} />
						<MonitorSettings />
					</>
				) : page === "meetings" ? (
					<MeetingHistory activation={meetingActivation} />
				) : page === "controls" ? (
					<DevicePicker>
						<HardwareSettings />
					</DevicePicker>
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
					<SettingsPage controller={maintenance}>
						<GeneralSettings
							setup={setup}
							onOpenSetup={() => open("setup")}
							onOpenPage={(next) => {
								setGuideDestination(next);
								open(next);
							}}
						/>
					</SettingsPage>
				) : page === "setup" ? (
					<SetupWizard
						store={setup}
						runtime={runtimeOption}
						onOpenPermissions={() => open("settings")}
						onLeave={() => open("overview")}
					/>
				) : page === "appearance" ? (
					<ThemeSettings controller={appearance} />
				) : null}
			</ManagementShell>
			<FirmwareDialog controller={maintenance} />
			<AppUpdateDialog controller={maintenance} />
			{maintenance.toast ? (
				<div role="status" className="maintenance-toast">
					{maintenance.toast}
				</div>
			) : null}
		</>
	);
}

export function App(): React.JSX.Element {
	if (new URLSearchParams(window.location.search).get("surface") === "icons")
		return <IconPickerSurface />;
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

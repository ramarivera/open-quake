import { useEffect, useRef, useState } from "react";
import { describeConnection } from "./management/connection";
import { OverviewPage } from "./management/OverviewPage";
import { mountStripTouch } from "./strip/mount-strip-touch";
import { ThemeSettings } from "./theme/ThemeSettings";
import {
	type AppearanceController,
	useAppearance,
} from "./theme/useAppearance";
import { StatusDot } from "./ui/Form";
import { AppearanceIcon, DeviceIcon, ScreenIcon } from "./ui/icons";
import { useQuakeEvents } from "./useQuakeEvents";
import { useWallpaper } from "./wallpaper/useWallpaper";
import { WallpaperPanel, WallpaperSettings } from "./wallpaper/WallpaperViews";
import "./styles.css";
import "./management/management.css";

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
		const root = document.getElementById("root");
		if (root && window.openQuake)
			return mountStripTouch(
				root,
				window.openQuake,
				Number(
					new URLSearchParams(window.location.search).get("rotation") ?? 0,
				),
			);
	}, []);
	return <WallpaperPanel />;
}

type Page = "overview" | "screen" | "appearance";

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
			{ id: "screen", label: "Screen", Icon: ScreenIcon },
		],
	},
	{
		title: "App",
		items: [{ id: "appearance", label: "Appearance", Icon: AppearanceIcon }],
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
	const [page, setPage] = useState<Page>("overview");
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
			<main className="content" ref={content}>
				<div className="content-inner">
					{page === "overview" ? (
						<OverviewPage
							quake={quake}
							connection={connection}
							snapshot={wallpaper.snapshot}
							onOpenScreen={() => open("screen")}
						/>
					) : page === "screen" ? (
						<WallpaperSettings wallpaper={wallpaper} />
					) : (
						<ThemeSettings controller={appearance} />
					)}
				</div>
			</main>
		</div>
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

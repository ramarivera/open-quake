import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type { AppearanceController } from "../theme/useAppearance";
import { PageSectionContext, StatusDot } from "../ui/Form";
import {
	AgentIcon,
	AppearanceIcon,
	ConnectionIcon,
	ControlsIcon,
	EmojiIcon,
	HomeIcon,
	KeysIcon,
	KnobIcon,
	MeetingIcon,
	MenuIcon,
	OverviewIcon,
	ScreenIcon,
	SettingsIcon,
	ShortcutIcon,
} from "../ui/icons";
import type { ConnectionSummary } from "./connection";
import {
	type ManagementPage,
	navSections,
	pageLayouts,
	pageLocation,
} from "./navigation";
import { UiSettings } from "./UiSettings";

const icons: Readonly<Record<ManagementPage, () => React.JSX.Element>> = {
	overview: OverviewIcon,
	keys: KeysIcon,
	profiles: KnobIcon,
	screen: ScreenIcon,
	controls: ControlsIcon,
	connection: ConnectionIcon,
	agents: AgentIcon,
	shortcuts: ShortcutIcon,
	emoji: EmojiIcon,
	meetings: MeetingIcon,
	"home-assistant": HomeIcon,
	appearance: AppearanceIcon,
	settings: SettingsIcon,
};

/** Narrow windows swap the sidebar for a Menu drawer (no icon-only rail). */
export const NARROW_QUERY = "(max-width: 759px)";
// Matches useAppearance's fallback for an unsaved width.
const DEFAULT_SIDEBAR = 218;

function useNarrow(): boolean {
	const [narrow, setNarrow] = useState(
		() => window.matchMedia?.(NARROW_QUERY).matches ?? false,
	);
	useEffect(() => {
		const query = window.matchMedia?.(NARROW_QUERY);
		if (!query) return;
		const update = (): void => setNarrow(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return narrow;
}

export function ManagementShell({
	page,
	onOpen,
	connection,
	runtimeStatus,
	runtimeLabel,
	runtimeSummary = runtimeLabel,
	appearance,
	contentRef,
	deviceReady,
	setupEntry,
	setupLabel = "Setup",
	children,
}: {
	/** "setup" is a route outside the nav sections (settings-and-wizard). */
	page: ManagementPage | "setup";
	onOpen: (page: ManagementPage | "setup") => void;
	connection: ConnectionSummary;
	runtimeStatus: string;
	runtimeLabel: string;
	/** Visible wording; the optional local runtime is not the whole assistant. */
	runtimeSummary?: string;
	appearance: AppearanceController;
	contentRef: React.RefObject<HTMLElement | null>;
	deviceReady: boolean;
	/** Optional sidebar entry shown while setup is unfinished. */
	setupEntry?: (
		navigate: (page: ManagementPage | "setup") => void,
	) => ReactNode;
	/** Localized name for the setup route in the breadcrumb and top bar. */
	setupLabel?: string;
	children?: ReactNode;
}): React.JSX.Element {
	const narrow = useNarrow();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const menuButton = useRef<HTMLButtonElement>(null);
	const sidebar = useRef<HTMLElement>(null);
	const location =
		page === "setup"
			? { section: null, label: setupLabel }
			: pageLocation(page);
	const drawer = narrow && drawerOpen;

	const closeDrawer = useCallback((): void => {
		setDrawerOpen(false);
		menuButton.current?.focus();
	}, []);
	useEffect(() => {
		if (!narrow) setDrawerOpen(false);
	}, [narrow]);
	useEffect(() => {
		if (!drawer) return;
		sidebar.current
			?.querySelector<HTMLButtonElement>('.nav-item[aria-current="page"]')
			?.focus();
		const onKey = (event: KeyboardEvent): void => {
			// The UI settings popover owns Escape while it is open.
			if (
				event.key === "Escape" &&
				!event.defaultPrevented &&
				!document.getElementById("mc-ui-settings")
			) {
				event.preventDefault();
				closeDrawer();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [drawer, closeDrawer]);

	const choose = (next: ManagementPage | "setup"): void => {
		onOpen(next);
		if (narrow) closeDrawer();
	};

	return (
		<div
			className="management-window"
			data-platform={window.quakeManagement?.platform ?? "web"}
			data-narrow={narrow || undefined}
		>
			<header className="mc-titlebar">
				<span className="mc-breadcrumb">
					{location.section ? (
						<>
							<span className="mc-breadcrumb-section">{location.section}</span>
							<span className="mc-breadcrumb-sep" aria-hidden="true">
								/
							</span>
						</>
					) : null}
					<span className="mc-breadcrumb-page">{location.label}</span>
				</span>
				<span
					className="mc-device-chip"
					data-tone={connection.tone}
					role="status"
				>
					<StatusDot tone={connection.tone} />
					<span className="mc-device-chip-name">QUAKE</span>
					<span className="sidebar-device-status">{connection.label}</span>
				</span>
			</header>
			<div className="mc-topbar">
				<button
					ref={menuButton}
					type="button"
					className="mc-menu-button"
					aria-expanded={drawerOpen}
					aria-controls="mc-sidebar"
					onClick={() => setDrawerOpen((open) => !open)}
				>
					<MenuIcon />
					<span>Menu</span>
				</button>
				<span className="mc-topbar-page">{location.label}</span>
			</div>
			<div className="app-shell">
				{drawer ? (
					<div
						className="mc-scrim"
						aria-hidden="true"
						onPointerDown={closeDrawer}
					/>
				) : null}
				<aside
					id="mc-sidebar"
					ref={sidebar}
					className="sidebar"
					data-drawer={narrow ? (drawerOpen ? "open" : "closed") : undefined}
					inert={narrow && !drawerOpen}
					aria-label="Management Center"
				>
					<div className="mc-product-mark">
						<span className="mc-product-icon" aria-hidden="true">
							<KnobIcon />
						</span>
						<span className="mc-product-text">
							<strong>open-quake</strong>
							<span className="mc-runtime">
								<span
									className="mc-runtime-dot"
									data-runtime={runtimeStatus}
									role="status"
									aria-label={runtimeLabel}
									title={runtimeLabel}
								/>
								<span aria-hidden="true">{runtimeSummary}</span>
							</span>
						</span>
					</div>
					<nav className="nav" aria-label="Sections">
						{navSections.map((section) => (
							<div
								key={section.id}
								className="nav-section"
								data-section={section.id}
							>
								{section.title ? (
									<h2 className="nav-heading">{section.title}</h2>
								) : null}
								<ul className="nav-list">
									{section.items.map(({ id, label }) => {
										const Icon = icons[id];
										return (
											<li key={id}>
												<button
													type="button"
													className="nav-item"
													data-nav-page={id}
													aria-current={page === id ? "page" : undefined}
													title={label}
													onClick={() => choose(id)}
												>
													<Icon />
													<span className="nav-label">{label}</span>
												</button>
											</li>
										);
									})}
								</ul>
							</div>
						))}
					</nav>
					{setupEntry?.(choose)}
					<footer className="mc-sidebar-footer">
						<UiSettings controller={appearance} />
					</footer>
				</aside>
				<SidebarResizer appearance={appearance} />
				<main
					className="content"
					ref={contentRef}
					data-session={deviceReady ? "device" : "preview"}
				>
					<PageSectionContext.Provider value={location.section}>
						<div
							className="content-inner"
							data-page={page}
							data-layout={page === "setup" ? "default" : pageLayouts[page]}
						>
							{children}
						</div>
					</PageSectionContext.Provider>
				</main>
			</div>
		</div>
	);
}

function SidebarResizer({
	appearance,
}: {
	appearance: AppearanceController;
}): React.JSX.Element {
	const drag = useRef<{
		pointer: number;
		startX: number;
		startWidth: number;
	} | null>(null);
	const saved = appearance.appearance.sidebarWidth ?? DEFAULT_SIDEBAR;
	const clamp = (width: number): number => Math.max(120, Math.min(360, width));
	const preview = (target: HTMLElement, width: number): void => {
		document.documentElement.style.setProperty(
			"--mc-sidebar-width",
			`${width}px`,
		);
		target.setAttribute("aria-valuenow", String(width));
	};
	return (
		<hr
			className="mc-resizer"
			tabIndex={0}
			aria-label="Drag to resize sidebar"
			aria-orientation="vertical"
			aria-valuemin={120}
			aria-valuemax={360}
			aria-valuenow={saved}
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
					event.preventDefault();
					appearance.setSidebarWidth(
						saved + (event.key === "ArrowRight" ? 8 : -8),
					);
				}
			}}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				drag.current = {
					pointer: event.pointerId,
					startX: event.clientX,
					startWidth: saved,
				};
				event.currentTarget.setPointerCapture(event.pointerId);
				document.body.dataset.resizing = "true";
			}}
			onPointerMove={(event) => {
				if (
					drag.current?.pointer === event.pointerId &&
					event.currentTarget.hasPointerCapture(event.pointerId)
				) {
					preview(
						event.currentTarget,
						clamp(
							drag.current.startWidth + event.clientX - drag.current.startX,
						),
					);
				}
			}}
			onPointerUp={(event) => {
				if (drag.current?.pointer !== event.pointerId) return;
				const { startX, startWidth } = drag.current;
				const width = clamp(startWidth + event.clientX - startX);
				drag.current = null;
				preview(event.currentTarget, width);
				if (width !== startWidth) appearance.setSidebarWidth(width);
				event.currentTarget.releasePointerCapture(event.pointerId);
				delete document.body.dataset.resizing;
			}}
			onLostPointerCapture={(event) => {
				if (drag.current) {
					drag.current = null;
					preview(event.currentTarget, saved);
				}
				delete document.body.dataset.resizing;
			}}
		/>
	);
}

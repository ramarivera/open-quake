import { Option } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCountdown } from "../../../../../../packages/device/src/actions/key-display-contracts.js";
import { localizedKey } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { KeyRuntimeState } from "../../../shared/key-library";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { useAppLocale } from "../i18n";
import { useKeyRuntime } from "../keys/useKeyRuntime";
import { WallpaperCanvas } from "../wallpaper/WallpaperCanvas";
import "./css-properties";
import {
	STRIP_CANVAS,
	type StripLayout,
	type StripTile,
	stripLayout,
	stripViewportScale,
} from "./geometry";
import {
	previewVoiceContext,
	type StripVoiceContext,
} from "./overlays/voice/voice-context";
import { deviceRadius, stripPaletteProperties } from "./palette";
import { selectStripPage } from "./selection";
import { stripTileFor } from "./tileRegistry";
import type { StripProfiles } from "./useStripProfiles";
import "./strip.css";

const palette = stripPaletteProperties();

/** Countdown, progress, alarm and invalid operation, drawn inside the tile. */
export function KeyState({
	state,
}: {
	state: KeyRuntimeState | undefined;
}): React.JSX.Element | null {
	if (!state) return null;
	const countdown =
		state.countdownPhase === "expired"
			? 0
			: state.countdown !== undefined && state.countdown >= 0
				? state.countdown
				: undefined;
	const progress =
		state.progress !== undefined && state.progress >= 0
			? state.progress
			: undefined;
	const alert = state.alert === 1 ? "!" : state.alert === 3 ? "✓" : undefined;
	if (countdown === undefined && progress === undefined && !alert) return null;
	return (
		<div
			className="strip-key-state"
			style={{
				position: "absolute",
				inset: 0,
				zIndex: 3001,
				pointerEvents: "none",
				display: "grid",
				placeItems: "center",
			}}
		>
			{countdown !== undefined ? (
				<span
					data-kind="countdown"
					style={{ fontSize: 48, fontWeight: 700, color: "#0000ff" }}
				>
					{formatCountdown(countdown)}
				</span>
			) : null}
			{alert ? (
				<span
					data-kind={state.alert === 1 ? "invalid" : "checkmark"}
					role="status"
					aria-label={state.alert === 1 ? "Invalid operation" : "Complete"}
					style={{
						position: "relative",
						zIndex: 1,
						width: 50,
						height: 50,
						background: "rgb(255,255,100)",
						color: "black",
						fontSize: 42,
						textAlign: "center",
					}}
				>
					{alert}
				</span>
			) : null}
			{progress !== undefined ? (
				<div
					className="strip-key-progress"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={100}
					aria-valuenow={Math.round(progress)}
					style={{
						position: "absolute",
						zIndex: 0,
						inset: 0,
						background: "#0a0a1a",
						overflow: "hidden",
					}}
				>
					<span
						style={{
							display: "block",
							height: "100%",
							width: `${progress}%`,
							background: "linear-gradient(45deg,#00f7ff,#0066ff)",
							borderRight: "4px solid #00f7ff",
						}}
					/>
					<span
						style={{
							position: "absolute",
							bottom: 8,
							right: 8,
							color: "#00ff9d",
							fontSize: 20,
							width: "auto",
							height: "auto",
							background: "none",
						}}
					>
						{Math.round(progress)}%
					</span>
				</div>
			) : null}
		</div>
	);
}

function StripGrid({
	layout,
	pressedKeyCode,
	now,
	hourFormat,
	voice,
	tileOverlay,
	interactive,
	runtime,
	clockSelection,
	currentPage,
}: {
	currentPage?: number | undefined;
	clockSelection?:
		| {
				readonly profileId: string;
				readonly pageId: string;
				readonly deviceId: string;
				readonly revision: number;
		  }
		| undefined;
	runtime: (keyCode: string) => KeyRuntimeState | undefined;
	layout: StripLayout;
	pressedKeyCode: string | undefined;
	now: Date | undefined;
	hourFormat: "24h" | "12h";
	voice: StripVoiceContext;
	tileOverlay: ((tile: StripTile) => React.ReactNode) | undefined;
	interactive: boolean;
}): React.JSX.Element {
	return (
		<div
			className="strip-grid"
			data-theme={layout.theme.name}
			inert={!interactive}
		>
			{layout.cells.map((cell) => (
				<div
					key={cell.keyCode}
					className="strip-slot"
					data-key-code={cell.placeholder.keyCode}
					data-state={cell.state}
					style={{
						left: cell.rect.x,
						top: cell.rect.y,
						width: cell.rect.width,
						height: cell.rect.height,
						borderRadius: deviceRadius(layout.theme.borderRadius),
					}}
				/>
			))}
			{layout.tiles.map((painted) => {
				const tile = {
					...painted,
					slotRadius: deviceRadius(painted.slotRadius),
					tileRadius: deviceRadius(painted.tileRadius),
				};
				const Tile = stripTileFor(tile.type);
				const locked =
					!interactive &&
					Option.isSome(tile.key.config.basicEditableItems) &&
					!tile.key.config.basicEditableItems.value.allowDrag;
				return (
					<div
						key={tile.keyCode}
						className="strip-slot"
						data-key-code={tile.keyCode}
						data-state="tile"
						data-edit-locked={locked || undefined}
						draggable={locked ? false : undefined}
						data-pressed={
							!locked && pressedKeyCode === tile.keyCode && tile.pressFeedback
								? "true"
								: undefined
						}
						data-press-scale={tile.pressScale ? "true" : undefined}
						style={{
							left: tile.slot.x,
							top: tile.slot.y,
							width: tile.slot.width,
							height: tile.slot.height,
							borderRadius: tile.slotRadius,
							zIndex: tile.zIndex || undefined,
						}}
					>
						<Tile
							tile={tile}
							context={{
								now,
								hourFormat,
								voice,
								currentPage,
								interactive,
								keyTarget: clockSelection,
								clockTarget: clockSelection
									? { ...clockSelection, keyCode: tile.keyCode }
									: undefined,
							}}
						/>
						<KeyState state={runtime(tile.keyCode)} />
						{tileOverlay?.(tile)}
					</div>
				);
			})}
		</div>
	);
}

/** The active page's layout; the panel also needs it for voice routing. */
export function useStripLayout(
	profiles: StripProfiles,
	serial: string | undefined,
	rows: 1 | 2 = 2,
): StripLayout | undefined {
	return useMemo(() => {
		if (profiles._tag !== "ready") return undefined;
		const { profile, page } = selectStripPage(profiles.envelope, serial);
		return stripLayout(profile, page, rows);
	}, [profiles, serial, rows]);
}

/**
 * The QUAKE strip on its fixed 1920×480 canvas: the wallpaper underneath, the
 * opaque key grid above it, then panel overlays (strip-key-grid "Strip canvas
 * and layer stack"). The panel window and the management preview both render
 * this component.
 */
export function StripScreen({
	profiles,
	wallpaper,
	view = "active",
	showEmptyGridDashedBorder,
	pressedKeyCode,
	voice = previewVoiceContext,
	tileOverlay,
	htmlOverlay,
	children,
	onLayout,
	previewSerial,
	titles = "key-locale",
	interactive = true,
	wallpaperSound = false,
	pendingProfile = false,
	rows = 2,
}: {
	profiles: StripProfiles;
	/** Committed profile is waiting for its matching grid snapshot. */
	pendingProfile?: boolean;
	rows?: 1 | 2;
	/** Profile Manager and the editor already resolve their own title locale. */
	titles?: "key-locale" | "provided";
	/** Selection previews paint live state but cannot operate nested controls. */
	interactive?: boolean;
	wallpaperSound?: boolean;
	previewSerial?: string;
	/** Reports the layout actually painted for the panel input adapter. */
	onLayout?: (layout: StripLayout | undefined) => void;
	wallpaper?: WallpaperSnapshot | undefined;
	/** "vivid" previews the wallpaper the vivid screen page shows. */
	view?: "active" | "vivid";
	showEmptyGridDashedBorder: boolean;
	pressedKeyCode?: string | undefined;
	/** Voice and chat state for AI tiles; the preview keeps the inert default. */
	voice?: StripVoiceContext;
	/** Drawn inside each visible tile's slot, above the tile (key alerts). */
	tileOverlay?: (tile: StripTile) => React.ReactNode;
	/** HTML layers above everything, in canvas pixels (voice overlay, toasts). */
	htmlOverlay?: React.ReactNode;
	/** Overlays in canvas coordinates, drawn above the grid. */
	children?: React.ReactNode;
}): React.JSX.Element {
	const runtimeStates = useKeyRuntime();
	const [feedbackKey, setFeedbackKey] = useState(pressedKeyCode);
	useEffect(() => {
		setFeedbackKey(pressedKeyCode);
		if (pressedKeyCode === undefined) return;
		// Bound the visual pulse independently of the input's held/action lifetime.
		const timer = setTimeout(() => setFeedbackKey(undefined), 200);
		return () => clearTimeout(timer);
	}, [pressedKeyCode]);
	const serial = previewSerial ?? wallpaper?.saved.serial;
	const screen = useRef<HTMLDivElement>(null);
	const { locale } = useAppLocale();
	useLayoutEffect(() => {
		const element = screen.current;
		if (interactive || !element) return;
		// inert handles real pointer/keyboard/focus input. Native sub-touch events
		// are programmatic and non-bubbling, so stop them in native capture too.
		const stop = (event: Event): void => {
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		const events = [
			"click",
			"auxclick",
			"dblclick",
			"contextmenu",
			"pointerdown",
			"pointermove",
			"pointerup",
			"pointercancel",
			"mousedown",
			"mousemove",
			"mouseup",
			"keydown",
			"keyup",
			"keypress",
			"touchstart",
			"touchmove",
			"touchend",
			"touchcancel",
			"dragstart",
			"drag",
			"dragover",
			"dragenter",
			"dragleave",
			"dragend",
			"drop",
			"wheel",
			"input",
			"change",
			"submit",
			"quake-sub-touch-start",
			"quake-sub-touch-end",
		];
		for (const event of events) element.addEventListener(event, stop, true);
		return () => {
			for (const event of events)
				element.removeEventListener(event, stop, true);
		};
	}, [interactive]);

	const layout = useMemo(() => {
		if (profiles._tag !== "ready") return undefined;
		const { profile, page } = selectStripPage(profiles.envelope, serial);
		return stripLayout(
			profile,
			{
				...page,
				keys: page.keys.map((key) => {
					const state = runtimeStates.get(
						JSON.stringify([
							serial ?? "desktop-preview",
							profile.id,
							page.id,
							key.keyCode,
						]),
					);
					const validState =
						state?.revision === undefined || state.revision === profile.revision
							? state
							: undefined;
					const translated =
						titles === "provided" ? key : localizedKey(key, locale);
					const decorated = validState?.icon
						? {
								...translated,
								config: { ...translated.config, icon: validState.icon },
							}
						: translated;
					return (key.config.type === "hotkeySwitch" ||
						key.config.type === "mute") &&
						validState?.alternate === 1
						? {
								...decorated,
								config: {
									...translated.config,
									icon: Option.getOrElse(
										translated.config.alterIcon,
										() => translated.config.icon,
									),
									title: Option.getOrElse(
										translated.config.alterTitle,
										() => translated.config.title,
									),
								},
							}
						: decorated;
				}),
			},
			rows,
		);
	}, [profiles, serial, locale, runtimeStates, titles, rows]);
	const vivid = view === "vivid" || (layout?.vivid ?? false);
	useLayoutEffect(() => {
		onLayout?.(vivid || pendingProfile ? undefined : layout);
		return () => onLayout?.(undefined);
	}, [layout, vivid, pendingProfile, onLayout]);
	const selection =
		profiles._tag === "ready"
			? selectStripPage(profiles.envelope, serial)
			: undefined;
	const runtime = (keyCode: string): KeyRuntimeState | undefined => {
		if (!selection) return undefined;
		const state = runtimeStates.get(
			JSON.stringify([
				serial ?? "desktop-preview",
				selection.profile.id,
				selection.page.id,
				keyCode,
			]),
		);
		if (
			state?.revision !== undefined &&
			state.revision !== selection.profile.revision
		)
			return undefined;
		const key = selection.page.keys.find((key) => key.keyCode === keyCode);
		return key?.config.type === "timer"
			? state
			: state
				? { ...state, countdown: -1, countdownPhase: "hidden" }
				: undefined;
	};
	const now = wallpaper ? new Date(wallpaper.clock.epochMillis) : undefined;
	const hourFormat = wallpaper?.saved.clock.actions[0].value ?? "24h";
	return (
		<div
			ref={screen}
			inert={!interactive}
			aria-hidden={!interactive || undefined}
			className="strip-screen"
			data-surface={interactive ? "panel" : "preview"}
			data-vivid={vivid}
			data-dashed={showEmptyGridDashedBorder}
			data-profiles={profiles._tag}
			data-wheel-open={voice.wheelOpen || undefined}
			style={{
				...palette,
				...STRIP_CANVAS,
				...(vivid && wallpaper?.saved.settings.isTransparent
					? { background: "transparent" }
					: {}),
			}}
		>
			{vivid && wallpaper?.asset._tag === "ready" ? (
				<div className="strip-wallpaper">
					<WallpaperCanvas snapshot={wallpaper} sound={wallpaperSound} />
				</div>
			) : null}
			{!vivid && layout ? (
				<StripGrid
					layout={layout}
					currentPage={
						selection
							? Math.min(
									10,
									selection.profile.pages.findIndex(
										(p) => p.id === selection.page.id,
									) + 1,
								)
							: undefined
					}
					pressedKeyCode={
						feedbackKey === pressedKeyCode ? feedbackKey : undefined
					}
					now={now}
					hourFormat={hourFormat}
					voice={voice}
					tileOverlay={tileOverlay}
					interactive={interactive && !pendingProfile}
					runtime={runtime}
					clockSelection={
						selection
							? {
									profileId: selection.profile.id,
									pageId: selection.page.id,
									revision: selection.profile.revision,
									deviceId: serial ?? "desktop-preview",
								}
							: undefined
					}
				/>
			) : null}
			{profiles._tag === "failure" && view === "active" ? (
				<div className="strip-status" role="status">
					<p className="strip-status-title">Profiles unavailable</p>
					<p className="strip-status-code">{profiles.code}</p>
				</div>
			) : null}
			{children ? (
				<svg
					className="strip-overlay"
					viewBox={`0 0 ${STRIP_CANVAS.width} ${STRIP_CANVAS.height}`}
				>
					<title>Panel controls</title>
					{children}
				</svg>
			) : null}
			{htmlOverlay ? <div className="voice-layer">{htmlOverlay}</div> : null}
		</div>
	);
}

/** Scales the fixed canvas to fit its container, preserving 4:1. */
export function StripViewport({
	children,
}: {
	children: React.ReactNode;
}): React.JSX.Element {
	const frame = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState(1);
	useLayoutEffect(() => {
		const element = frame.current;
		if (!element) return;
		const update = (): void => {
			// Layout size, not the bounding box: the panel window may rotate #root.
			const { clientWidth: width, clientHeight: height } = element;
			setScale(stripViewportScale(width, height));
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<div className="strip-viewport" ref={frame}>
			<div
				className="strip-viewport-stage"
				style={{
					width: STRIP_CANVAS.width,
					height: STRIP_CANVAS.height,
					transform: `translate(-50%, -50%) scale(${scale})`,
				}}
			>
				{children}
			</div>
		</div>
	);
}

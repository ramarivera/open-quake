import { Option, Schema } from "effect";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { localizedKey } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { useKeyRuntime } from "../keys/useKeyRuntime";
import { WallpaperCanvas } from "../wallpaper/WallpaperCanvas";
import "./css-properties";
import {
	STRIP_CANVAS,
	type StripLayout,
	type StripTile,
	stripLayout,
} from "./geometry";
import {
	previewVoiceContext,
	type StripVoiceContext,
} from "./overlays/voice/voice-context";
import { stripPaletteProperties } from "./palette";
import { selectStripPage } from "./selection";
import { stripTileFor } from "./tileRegistry";
import type { StripProfiles } from "./useStripProfiles";
import "./strip.css";

const palette = stripPaletteProperties();

const storedKeyLocale = (): ProfileLocale => {
	if (typeof localStorage === "undefined") return "en";
	const decoded = Schema.decodeUnknownEither(ProfileLocale)(
		localStorage.getItem("open-quake-key-locale") ?? "en",
	);
	return decoded._tag === "Right" ? decoded.right : "en";
};

function StripGrid({
	layout,
	pressedKeyCode,
	now,
	hourFormat,
	voice,
	tileOverlay,
	interactive,
}: {
	layout: StripLayout;
	pressedKeyCode: string | undefined;
	now: Date | undefined;
	hourFormat: "24h" | "12h";
	voice: StripVoiceContext;
	tileOverlay: ((tile: StripTile) => React.ReactNode) | undefined;
	interactive: boolean;
}): React.JSX.Element {
	return (
		<div className="strip-grid" data-theme={layout.theme.name}>
			{layout.cells.map((cell) => (
				<div
					key={cell.keyCode}
					className="strip-slot"
					data-key-code={cell.keyCode}
					data-state={cell.state}
					style={{
						left: cell.rect.x,
						top: cell.rect.y,
						width: cell.rect.width,
						height: cell.rect.height,
						borderRadius: layout.theme.borderRadius,
					}}
				/>
			))}
			{layout.tiles.map((tile) => {
				const Tile = stripTileFor(tile.type);
				return (
					<div
						key={tile.keyCode}
						className="strip-slot"
						data-key-code={tile.keyCode}
						data-state="tile"
						data-pressed={
							pressedKeyCode === tile.keyCode && tile.pressFeedback
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
							context={{ now, hourFormat, voice, interactive }}
						/>
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
): StripLayout | undefined {
	return useMemo(() => {
		if (profiles._tag !== "ready") return undefined;
		const { profile, page } = selectStripPage(profiles.envelope, serial);
		return stripLayout(profile, page);
	}, [profiles, serial]);
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
}: {
	profiles: StripProfiles;
	/** Profile Manager and the editor already resolve their own title locale. */
	titles?: "key-locale" | "provided";
	/** Selection previews paint live state but cannot operate nested controls. */
	interactive?: boolean;
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
	const serial = previewSerial ?? wallpaper?.saved.serial;
	const screen = useRef<HTMLDivElement>(null);
	const [locale, setLocale] = useState(() =>
		titles === "key-locale" ? storedKeyLocale() : "en",
	);
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
	useEffect(() => {
		if (titles === "provided") return;
		const update = (): void => setLocale(storedKeyLocale());
		update();
		window.addEventListener("storage", update);
		window.addEventListener("key-locale", update);
		return () => {
			window.removeEventListener("storage", update);
			window.removeEventListener("key-locale", update);
		};
	}, [titles]);
	const layout = useMemo(() => {
		if (profiles._tag !== "ready") return undefined;
		const { profile, page } = selectStripPage(profiles.envelope, serial);
		return stripLayout(profile, {
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
				const translated =
					titles === "provided" ? key : localizedKey(key, locale);
				return state?.alternate === 1
					? {
							...translated,
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
					: translated;
			}),
		});
	}, [profiles, serial, locale, runtimeStates, titles]);
	const vivid = view === "vivid" || (layout?.vivid ?? false);
	useLayoutEffect(() => {
		onLayout?.(vivid ? undefined : layout);
		return () => onLayout?.(undefined);
	}, [layout, vivid, onLayout]);
	const now = wallpaper ? new Date(wallpaper.clock.epochMillis) : undefined;
	const hourFormat = wallpaper?.saved.clock.actions[0].value ?? "24h";
	return (
		<div
			ref={screen}
			inert={!interactive}
			aria-hidden={!interactive || undefined}
			className="strip-screen"
			data-vivid={vivid}
			data-dashed={showEmptyGridDashedBorder}
			data-profiles={profiles._tag}
			style={{ ...palette, ...STRIP_CANVAS }}
		>
			{vivid && wallpaper?.asset._tag === "ready" ? (
				<div className="strip-wallpaper">
					<WallpaperCanvas snapshot={wallpaper} />
				</div>
			) : null}
			{!vivid && layout ? (
				<StripGrid
					layout={layout}
					pressedKeyCode={pressedKeyCode}
					now={now}
					hourFormat={hourFormat}
					voice={voice}
					tileOverlay={tileOverlay}
					interactive={interactive}
				/>
			) : null}
			{profiles._tag === "failure" && view === "active" ? (
				<div className="strip-status" role="status">
					<p className="strip-status-title">Profiles unavailable</p>
					<p className="strip-status-code">{profiles.code}</p>
				</div>
			) : null}
			{layout && !vivid ? (
				<svg
					className="strip-overlay"
					viewBox="0 0 1920 480"
					aria-label="Key progress"
				>
					{layout.tiles.map((tile) => {
						const selection =
							profiles._tag === "ready"
								? selectStripPage(profiles.envelope, serial)
								: undefined;
						const state = selection
							? runtimeStates.get(
									JSON.stringify([
										serial ?? "desktop-preview",
										selection.profile.id,
										selection.page.id,
										tile.keyCode,
									]),
								)
							: undefined;
						if (!state) return null;
						return (
							<g key={tile.keyCode} pointerEvents="none">
								{state.countdown !== undefined && state.countdown >= 0 ? (
									<text
										x={tile.slot.x + tile.slot.width / 2}
										y={tile.slot.y + tile.slot.height * 0.65}
										textAnchor="middle"
										fill="white"
										fontSize={32}
									>
										{Math.ceil(state.countdown / 1000)}
									</text>
								) : null}
								{state.progress !== undefined && state.progress < 100 ? (
									<rect
										x={tile.slot.x + 16}
										y={tile.slot.y + tile.slot.height - 26}
										width={((tile.slot.width - 32) * state.progress) / 100}
										height={8}
										fill="#409eff"
									/>
								) : null}
								{state.alert === 2 ? (
									<text
										x={tile.slot.x + tile.slot.width / 2}
										y={tile.slot.y + tile.slot.height * 0.65}
										textAnchor="middle"
										fill="#ffbd66"
										fontSize={32}
									>
										Alarm
									</text>
								) : null}
								{state.alert === 1 ? (
									<text
										x={tile.slot.x + tile.slot.width / 2}
										y={tile.slot.y + tile.slot.height * 0.65}
										textAnchor="middle"
										fill="#ff6b6b"
										fontSize={24}
									>
										Invalid operation
									</text>
								) : null}
							</g>
						);
					})}
				</svg>
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
			if (width > 0 && height > 0)
				setScale(
					Math.min(width / STRIP_CANVAS.width, height / STRIP_CANVAS.height),
				);
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

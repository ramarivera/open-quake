import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fillGeometry, PANEL_CANVAS } from "../../../shared/display";
import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { useAmbientStyle } from "./ambient-appearance";
import {
	type AmbientAudio,
	idleAmbientAudio,
	observeAmbientAudio,
} from "./ambient-audio";
import { type WallpaperLayer, WallpaperLayers } from "./layer-player";
import "./wallpaper.css";

function MediaLayer({
	layer,
	sound,
	player,
	reactive,
	onAudio,
}: {
	layer: WallpaperLayer;
	sound: boolean;
	player: WallpaperLayers;
	reactive: boolean;
	onAudio: (value: AmbientAudio) => void;
}): React.JSX.Element | null {
	const video = useRef<HTMLVideoElement>(null);
	const loaded = useCallback(() => player.loaded(layer.id), [player, layer.id]);
	const failed = useCallback(() => player.error(layer.id), [player, layer.id]);
	const media = layer.snapshot.saved.settings.displayMediaList[layer.index];
	const asset = layer.asset;
	const active = layer.state === "active";
	const url = asset._tag === "ready" ? asset.dataUrl : undefined;
	const startedAt = layer.snapshot.playbackStartedAt;
	const loop =
		layer.snapshot.loop ??
		layer.snapshot.saved.settings.displayMediaList.length === 1;
	useEffect(() => {
		const element = video.current;
		if (!element) return;
		let started = false;
		const play = () => {
			if (!active || document.hidden) {
				element.pause();
				return;
			}
			if (started) return;
			started = true;
			const elapsed = Math.max(
				0,
				(Date.now() - (startedAt ?? Date.now())) / 1000,
			);
			if (Number.isFinite(element.duration) && element.duration > 0)
				element.currentTime = loop
					? elapsed % element.duration
					: Math.min(elapsed, element.duration);
			void element.play().catch(failed);
		};
		if (element.readyState >= 4) play();
		element.addEventListener("canplaythrough", play);
		return () => {
			element.removeEventListener("canplaythrough", play);
			element.pause();
		};
	}, [active, startedAt, loop, failed]);
	useEffect(() => {
		const element = video.current;
		return () => {
			if (element) {
				element.pause();
				element.removeAttribute("src");
				element.load();
			}
		};
	}, []);
	const serial = layer.snapshot.saved.serial,
		revision = layer.snapshot.saved.revision;
	const audible =
		active &&
		sound &&
		layer.snapshot.saved.settings.enableSound &&
		media?.type === "video";
	useEffect(() => {
		if (!audible) return;
		const id = `${layer.id}:${crypto.randomUUID()}`;
		void window.quakeWallpaper?.audio?.({ id, serial, revision, active: true });
		return () => {
			void window.quakeWallpaper?.audio?.({
				id,
				serial,
				revision,
				active: false,
			});
		};
	}, [audible, serial, revision, layer.id]);
	useEffect(() => {
		if (!active) return;
		const element = video.current;
		onAudio(idleAmbientAudio);
		if (!reactive || !audible || !element) return;
		const stop = observeAmbientAudio(element, onAudio);
		return () => {
			stop();
			onAudio(idleAmbientAudio);
		};
	}, [active, audible, reactive, onAudio]);
	if (asset._tag !== "ready") return null;
	const geometry = fillGeometry(
		layer.snapshot.saved.settings.bgFillMode,
		asset.width,
		asset.height,
	);
	return (
		<g
			className="wallpaper-layer"
			data-state={layer.state}
			data-layer-id={layer.id}
			style={{ opacity: layer.state === "active" ? 1 : 0 }}
		>
			{media?.type === "video" ? (
				<foreignObject x="0" y="0" width="1920" height="480">
					<video
						ref={video}
						src={url}
						playsInline
						preload="auto"
						muted={!audible}
						loop={loop}
						onCanPlayThrough={loaded}
						onError={failed}
						style={{
							width: "1920px",
							height: "480px",
							objectFit:
								layer.snapshot.saved.settings.bgFillMode === "center"
									? "none"
									: layer.snapshot.saved.settings.bgFillMode,
						}}
					/>
				</foreignObject>
			) : (
				<image
					href={url}
					{...geometry}
					preserveAspectRatio="none"
					onLoad={loaded}
					onError={failed}
				>
					<title>{media?.name ?? "Wallpaper"}</title>
				</image>
			)}
		</g>
	);
}

/** Shared native panel and muted management preview, on the design canvas. */
export function WallpaperCanvas({
	snapshot,
	sound = false,
}: {
	snapshot?: WallpaperSnapshot | undefined;
	sound?: boolean;
}): React.JSX.Element {
	const { style } = useAmbientStyle(snapshot?.saved.serial);
	const [audio, setAudio] = useState<AmbientAudio>(idleAmbientAudio);
	const reactive = style === "lava" || style === "ambilight";
	const initial: readonly WallpaperLayer[] =
		snapshot?.asset._tag === "ready" && !snapshot.saved.settings.isTransparent
			? [
					{
						id: 0,
						index: snapshot.activeIndex ?? 0,
						snapshot,
						asset: snapshot.asset,
						state: "active",
					},
				]
			: [];
	const [layers, setLayers] = useState(initial);
	const canvas = useRef<SVGSVGElement>(null);
	const player = useMemo(
		() =>
			new WallpaperLayers(
				setLayers,
				(current, index) => {
					void window.quakeWallpaper?.request({
						_tag: "failed",
						serial: current.saved.serial,
						revision: current.saved.revision,
						playbackId: current.playbackId ?? 0,
						index,
					});
				},
				() =>
					window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
					false,
			),
		[],
	);
	useEffect(() => {
		if (snapshot) player.apply(snapshot);
	}, [player, snapshot]);
	useEffect(() => {
		const visibility = () => player.visibility(document.hidden);
		visibility();
		document.addEventListener("visibilitychange", visibility);
		const element = canvas.current;
		let width = 0,
			height = 0;
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver((entries) => {
						const size = entries[0]?.contentRect;
						if (!size) return;
						if (
							width &&
							height &&
							(width !== size.width || height !== size.height)
						)
							player.resize();
						width = size.width;
						height = size.height;
					});
		if (element) observer?.observe(element);
		return () => {
			document.removeEventListener("visibilitychange", visibility);
			observer?.disconnect();
			player.dispose();
		};
	}, [player]);
	const transparent = snapshot?.saved.settings.isTransparent;
	return (
		<svg
			ref={canvas}
			className={`wallpaper-canvas${transparent ? " wallpaper-transparent" : ""}`}
			viewBox={`0 0 ${PANEL_CANVAS.width} ${PANEL_CANVAS.height}`}
			role="img"
			aria-label="Wallpaper"
			data-revision={snapshot?.saved.revision}
		>
			<title>Wallpaper</title>
			{!transparent ? (
				<>
					<rect width="1920" height="480" className="wallpaper-neutral" />
					<g
						opacity={style === "media" ? 1 : 0}
						aria-hidden={style !== "media"}
					>
						{(style === "media" || reactive ? layers : []).map((layer) => (
							<MediaLayer
								key={layer.id}
								layer={layer}
								sound={sound}
								player={player}
								reactive={reactive}
								onAudio={setAudio}
							/>
						))}
					</g>
					{style !== "media" ? (
						<AmbientBackdrop style={style} audio={audio} />
					) : null}
				</>
			) : null}
		</svg>
	);
}

import { Schema } from "effect";
import { useEffect, useId, useRef, useState } from "react";
import {
	ObsCommand,
	obsCommandFromKey,
} from "../../../../../../packages/device/src/actions/obs-contracts";
import type { ObsTile as Tile } from "../../../../../../packages/edge/src/obs/obs-contracts";
import { storedKeyLocale } from "../keys/key-locale";
import type { StripTileProps } from "../strip/tileRegistry";
import { obsText } from "./strings";
import "./obs.css";
export function ObsTile({ tile }: StripTileProps): React.JSX.Element {
	const lease = useId(),
		host = useRef<HTMLDivElement>(null);
	const [live, setLive] = useState<Tile>();
	const [locale, setLocale] = useState(storedKeyLocale);
	const command = obsCommandFromKey(tile.key);
	const encoded = command._tag === "Right" ? JSON.stringify(command.right) : "";
	useEffect(() => {
		const changed = () => setLocale(storedKeyLocale());
		window.addEventListener("key-locale", changed);
		return () => window.removeEventListener("key-locale", changed);
	}, []);
	useEffect(() => {
		const bridge = window.quakeObs;
		if (!bridge || !encoded) return;
		let intersection = true;
		const decoded = Schema.decodeUnknownEither(Schema.parseJson(ObsCommand))(
			encoded,
		);
		if (decoded._tag === "Left") return;
		const off = bridge.onLive((event) => {
			if (event.lease === lease)
				setLive(event.tiles.find((entry) => entry.id === tile.keyCode));
		});
		const visible = () => {
			setLive(undefined);
			void bridge
				.request({
					type: "visible",
					lease,
					tiles:
						!document.hidden && intersection
							? [{ id: tile.keyCode, command: decoded.right }]
							: [],
				})
				.catch(() => setLive(undefined));
		};
		const observer =
			typeof IntersectionObserver === "undefined"
				? undefined
				: new IntersectionObserver((entries) => {
						intersection = entries.some((entry) => entry.isIntersecting);
						visible();
					});
		if (host.current) observer?.observe(host.current);
		// A draft preview can precede its committed authorization in main.
		const offProfiles = window.quakeProfiles?.onSnapshot(visible);
		document.addEventListener("visibilitychange", visible);
		visible();
		return () => {
			off();
			offProfiles?.();
			observer?.disconnect();
			document.removeEventListener("visibilitychange", visible);
			void bridge
				.request({ type: "visible", lease, tiles: [] })
				.catch(() => {});
		};
	}, [encoded, lease, tile.keyCode]);
	const label = obsText(locale, "labels", tile.type);
	const connected = live?.connected === true;
	return (
		<div
			ref={host}
			className={`strip-tile-layer obs-tile ${tile.type === "obsStats" ? "obs-tile-stats" : ""}`}
			role="status"
			aria-label={`OBS ${label}`}
		>
			{!connected ? (
				<span className="obs-offline">
					{obsText(locale, "config", "notConnected")}
				</span>
			) : tile.type === "obsScreenshot" ? (
				live.image ? (
					<img src={live.image} alt={label} className="obs-screenshot" />
				) : (
					<span>{obsText(locale, "config", "notConnected")}</span>
				)
			) : tile.type === "obsStats" ? (
				<>
					<span>CPU {live.values[0]?.toFixed(1) ?? "N/A"}%</span>
					<span>
						{{
							en: "Dropped frames",
							zh: "丢帧",
							de: "Verworfene Frames",
							es: "Fotogramas perdidos",
							fr: "Images perdues",
							it: "Frame persi",
							ja: "ドロップフレーム",
							ko: "손실 프레임",
						}[locale] ?? "Dropped frames"}{" "}
						{live.values[1] ?? "N/A"}
					</span>
					<span>
						{{
							en: "Render",
							zh: "渲染",
							de: "Rendern",
							es: "Renderizado",
							fr: "Rendu",
							it: "Rendering",
							ja: "レンダリング",
							ko: "렌더링",
						}[locale] ?? "Render"}{" "}
						{live.values[2] ?? "N/A"}/{live.values[3] ?? "N/A"}
					</span>
				</>
			) : (
				<span style={{ color: live.color }}>
					{obsText(locale, "status", live.text) === live.text
						? obsText(locale, "labels", live.text)
						: obsText(locale, "status", live.text)}
				</span>
			)}
		</div>
	);
}

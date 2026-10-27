import { Schema } from "effect";
import { useEffect, useState } from "react";
import {
	ForegroundArtwork,
	MonitorReply,
} from "../../../shared/monitor-contracts";
import type { StripTileProps } from "../strip/tileRegistry";
import { useMonitor } from "../strip/tiles/monitor/useMonitor";
import { useHardwareText } from "./strings";
import "./hardware.css";

export function GameModeTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const t = useHardwareText();
	const state = context.hardware;
	const gaming = state?.available ? state.inputMode === "device" : undefined;
	const [artwork, setArtwork] = useState("");
	const [failed, setFailed] = useState(false);
	const monitor = tile.key.config.actions.some(
		(a) => a.type === "monitorAppView" && a.value === true,
	);
	useMonitor(monitor && context.interactive !== false && gaming === true);
	useEffect(() => {
		setArtwork("");
		if (!monitor || context.interactive === false || gaming !== true) return;
		let live = true;
		const bridge = window.quakeMonitor;
		const update = (value: unknown) => {
			if (live && Schema.is(ForegroundArtwork)(value))
				setArtwork(value.artwork);
		};
		const off = bridge?.onArtwork?.(update);
		void bridge
			?.request({ _tag: "artwork" })
			.then((value) => {
				if (
					Schema.is(MonitorReply)(value) &&
					value._tag === "foregroundArtwork"
				)
					update(value);
			})
			.catch(() => undefined);
		return () => {
			live = false;
			off?.();
		};
	}, [monitor, gaming, context.interactive]);
	return (
		<button
			type="button"
			className="hardware-game-tile"
			data-gaming={gaming}
			data-failed={failed}
			aria-label={t("gameMode")}
			aria-pressed={gaming}
			disabled={context.interactive === false || gaming === undefined}
			onClick={async () => {
				const target = context.keyTarget;
				if (!target || !window.quakeKeyLibrary) return;
				setFailed(false);
				try {
					const result = await window.quakeKeyLibrary.request({
						...target,
						keyCode: tile.keyCode,
						type: "activate",
						kind: "press",
					});
					await window.quakeKeyLibrary.request({
						...target,
						keyCode: tile.keyCode,
						type: "activate",
						kind: "release",
					});
					setFailed(result._tag !== "success");
				} catch {
					setFailed(true);
				}
			}}
		>
			{artwork ? (
				<img
					className="hardware-game-artwork"
					src={artwork}
					alt={t("foreground")}
				/>
			) : (
				<svg viewBox="0 0 100 64" aria-hidden="true">
					<path
						d="M27 10h46c10 0 19 31 17 40-3 12-15 6-24-5H34C25 56 13 62 10 50 8 41 17 10 27 10Z"
						fill="none"
						stroke="currentColor"
						strokeWidth="4"
					/>
					<path d="M27 22v18m-9-9h18" stroke="currentColor" strokeWidth="4" />
					<circle cx="67" cy="27" r="3" fill="currentColor" />
					<circle cx="77" cy="37" r="3" fill="currentColor" />
				</svg>
			)}
			<span role="status">
				{failed
					? t("modeFailed")
					: gaming === undefined
						? t("offline")
						: gaming
							? t("gaming")
							: t("normal")}
			</span>
		</button>
	);
}

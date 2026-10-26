import { useLayoutEffect, useRef, useState } from "react";
import type { ClockTarget } from "../../../shared/clock-contracts";
import { cycleTheme } from "../../../shared/clock-style";
import type { StripTile } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import { stripTileFor } from "../strip/tileRegistry";
import {
	themeOf,
	useClockSettings,
} from "../strip/tiles/clock/useClockSettings";

/** The same tile renderer as the strip, scaled inside a bounded selected card. */
export function SelectedKeyPreview({
	tile,
	target,
	beforeWrite,
	onSaved,
}: {
	tile: StripTile;
	target: ClockTarget;
	beforeWrite: () => Promise<boolean>;
	onSaved: () => Promise<void>;
}): React.JSX.Element {
	const frame = useRef<HTMLDivElement>(null);
	const [side, setSide] = useState(80 * 0.85);
	useLayoutEffect(() => {
		const node = frame.current;
		if (!node) return;
		const update = (): void =>
			setSide(
				Math.max(
					80,
					Math.min(
						node.clientWidth / (tile.type === "cameraView" ? 1.5 : 1),
						node.clientHeight,
					),
				) * 0.85,
			);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}, [tile.type]);
	const width = side * (tile.type === "cameraView" ? 1.5 : 1);
	const Tile = stripTileFor(tile.type);
	return (
		<section
			className="key-selected-preview"
			aria-label="Selected tile preview"
		>
			<div ref={frame} className="key-selected-preview-frame">
				<div
					inert
					style={{
						width,
						height: side,
						overflow: "hidden",
						pointerEvents: "none",
						position: "relative",
					}}
					data-preview-width={width}
					data-preview-height={side}
				>
					<div
						style={{
							width: tile.box.width,
							height: tile.box.height,
							transform: `scale(${width / tile.box.width}, ${side / tile.box.height})`,
							transformOrigin: "0 0",
							position: "absolute",
						}}
					>
						<Tile
							tile={tile}
							context={{
								now: undefined,
								hourFormat: "24h",
								voice: previewVoiceContext,
								interactive: false,
								clockTarget: target,
							}}
						/>
					</div>
				</div>
			</div>
			{tile.type === "dkDesktopClock" && (
				<ClockPreviewControls
					target={target}
					beforeWrite={beforeWrite}
					onSaved={onSaved}
				/>
			)}
		</section>
	);
}

function ClockPreviewControls({
	target,
	beforeWrite,
	onSaved,
}: {
	target: ClockTarget;
	beforeWrite: () => Promise<boolean>;
	onSaved: () => Promise<void>;
}): React.JSX.Element {
	const clock = useClockSettings(undefined, target, beforeWrite);
	const [busy, setBusy] = useState(false);
	const writing = useRef(false);
	const change = async (delta: -1 | 1): Promise<void> => {
		if (!clock.snapshot || writing.current) return;
		writing.current = true;
		setBusy(true);
		try {
			const active = themeOf(clock.snapshot);
			const result = await clock.selectTheme(
				cycleTheme(active === "none" ? null : active, delta),
			);
			if (result.ok) await onSaved();
		} finally {
			writing.current = false;
			setBusy(false);
		}
	};
	return (
		<div className="key-selected-preview-controls">
			<button
				type="button"
				aria-label="Previous clock theme"
				disabled={!clock.snapshot || busy}
				onClick={() => void change(-1)}
			>
				◀
			</button>
			<button
				type="button"
				aria-label="Next clock theme"
				disabled={!clock.snapshot || busy}
				onClick={() => void change(1)}
			>
				▶
			</button>
		</div>
	);
}

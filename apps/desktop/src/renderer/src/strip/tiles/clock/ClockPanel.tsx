import { type ReactNode, useEffect, useRef, useState } from "react";
import { useWallpaper } from "../../../wallpaper/useWallpaper";
import { ClockTile } from "./ClockTile";
import { useClockNow } from "./clockHooks";
import { mediaOf, themeOf, useClockSettings } from "./useClockSettings";

function useElementSize(
	ref: React.RefObject<HTMLElement | null>,
): { width: number; height: number } | undefined {
	const [size, setSize] = useState<{ width: number; height: number }>();
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		// Layout size, so a rotated strip window still measures 1920×480.
		const update = (): void =>
			setSize({ width: element.clientWidth, height: element.clientHeight });
		const observer = new ResizeObserver(update);
		observer.observe(element);
		update();
		return () => observer.disconnect();
	}, [ref]);
	return size;
}

/**
 * Temporary full-strip host for the DK-Desktop-Clock profile until the strip
 * grid (open-quake-lih.2) renders profiles and registers `ClockTile` itself.
 */
export function ClockPanel({
	overlay,
}: {
	/** Panel-only SVG layers in 1920×480 canvas coordinates. */
	overlay?: ReactNode;
}): React.JSX.Element {
	const ref = useRef<HTMLElement>(null);
	const size = useElementSize(ref);
	const { snapshot, available, selectTheme } = useClockSettings();
	const { snapshot: wallpaper } = useWallpaper();
	const now = useClockNow(snapshot?.showSeconds ?? false);
	// Wait for the saved theme rather than flashing the default first.
	const ready = !available || snapshot !== undefined;
	return (
		<main
			ref={ref}
			className="oq-clock-panel"
			aria-label="Quake device panel"
			data-profile="dk-desktop-clock"
		>
			{size && ready ? (
				<ClockTile
					widthPx={size.width}
					heightPx={size.height}
					now={now}
					theme={snapshot ? themeOf(snapshot) : "season"}
					hourFormat={wallpaper?.saved.clock.actions[0].value ?? "24h"}
					showSeconds={snapshot?.showSeconds ?? false}
					media={mediaOf(snapshot)}
					onThemeSelect={selectTheme}
				/>
			) : null}
			{overlay ? (
				<svg
					className="oq-clock-panel-overlay"
					viewBox="0 0 1920 480"
					aria-hidden="true"
				>
					{overlay}
				</svg>
			) : null}
		</main>
	);
}

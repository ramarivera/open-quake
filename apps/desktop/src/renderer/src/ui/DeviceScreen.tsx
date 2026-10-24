import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { WallpaperCanvas } from "../wallpaper/WallpaperCanvas";

/**
 * The panel canvas framed like the QUAKE's display strip. It renders the same
 * WallpaperCanvas the panel window uses, so the preview cannot drift from it.
 */
export function DeviceScreen({
	snapshot,
	size = "regular",
}: {
	snapshot?: WallpaperSnapshot | undefined;
	size?: "regular" | "large";
}): React.JSX.Element {
	return (
		<figure className="device-screen" data-size={size}>
			<div className="device-bezel">
				<div className="device-glass">
					<WallpaperCanvas snapshot={snapshot} />
				</div>
			</div>
			<figcaption className="visually-hidden">
				Preview of the QUAKE screen, 1920 × 480
			</figcaption>
		</figure>
	);
}

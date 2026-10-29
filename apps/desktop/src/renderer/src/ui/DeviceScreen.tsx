import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { StripScreen, StripViewport } from "../strip/StripScreen";
import { useStripSettings } from "../strip/stripSettings";
import { useStripProfiles } from "../strip/useStripProfiles";

/**
 * The QUAKE's display strip in a bezel. It renders the same StripScreen as the
 * panel window, from the same profile and wallpaper snapshots, so the preview
 * cannot drift from the device.
 */
export function DeviceScreen({
	snapshot,
	size = "regular",
	view = "active",
}: {
	snapshot?: WallpaperSnapshot | undefined;
	size?: "regular" | "large";
	view?: "active" | "vivid";
}): React.JSX.Element {
	const profiles = useStripProfiles();
	const { settings } = useStripSettings();
	return (
		<figure className="device-screen" data-size={size}>
			<div className="device-bezel">
				<div className="device-glass">
					<StripViewport>
						<StripScreen
							interactive={false}
							monitoringPreview
							profiles={profiles}
							wallpaper={snapshot}
							view={view}
							showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
						/>
					</StripViewport>
				</div>
			</div>
			<figcaption className="visually-hidden">
				{view === "vivid"
					? "Preview of the QUAKE's Ambient screen, 1920 × 480"
					: "Preview of the QUAKE screen, 1920 × 480"}
			</figcaption>
		</figure>
	);
}

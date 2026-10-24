import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "../wallpaper/useWallpaper";
import { StripScreen, StripViewport } from "./StripScreen";
import { useStripSettings } from "./stripSettings";
import { useStripProfiles } from "./useStripProfiles";

/**
 * The `?surface=panel` window: the active profile's key grid on the QUAKE
 * strip, with the existing knob/touch feedback drawn above it until the knob
 * and touch lanes replace that layer.
 */
export function StripPanel(): React.JSX.Element {
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const profiles = useStripProfiles();
	const { settings } = useStripSettings();
	return (
		<main className="strip-panel" aria-label="Quake device panel">
			<StripViewport>
				<StripScreen
					profiles={profiles}
					wallpaper={snapshot}
					showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
				>
					<PanelFeedbackLayer view={feedback} />
				</StripScreen>
			</StripViewport>
		</main>
	);
}

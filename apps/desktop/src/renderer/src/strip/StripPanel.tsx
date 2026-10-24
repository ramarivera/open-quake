import { useCallback, useEffect, useRef, useState } from "react";
import {
	createPanelKeyDispatcher,
	type PanelKeyTarget,
} from "../keys/panel-key-dispatch";
import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "../wallpaper/useWallpaper";
import type { StripLayout } from "./geometry";
import { mountStripTouch } from "./mount-strip-touch";
import { KnobPanelLayer } from "./overlays/knob/KnobPanelLayer";
import { StripScreen, StripViewport } from "./StripScreen";
import { selectStripPage } from "./selection";
import { useStripSettings } from "./stripSettings";
import { useStripProfiles } from "./useStripProfiles";

/**
 * The `?surface=panel` window: the active profile's key grid on the QUAKE
 * strip, with touch bound to its rendered layout and feedback above it.
 */
export function StripPanel(): React.JSX.Element {
	const target = useRef<PanelKeyTarget | undefined>(undefined);
	const layout = useRef<StripLayout | undefined>(undefined);
	const [pressedKeyCode, setPressedKeyCode] = useState<string>();
	const onLayout = useCallback((current: StripLayout | undefined) => {
		layout.current = current;
	}, []);
	useEffect(() => {
		const root = document.getElementById("root");
		const dispatch = createPanelKeyDispatcher(
			() => target.current,
			(request) => window.quakeKeyLibrary.request(request),
		);
		if (root && window.openQuake)
			return mountStripTouch(
				root,
				window.openQuake,
				Number(
					new URLSearchParams(window.location.search).get("rotation") ?? 0,
				),
				() => layout.current,
				(event) => {
					setPressedKeyCode(event.keyAction === 0 ? event.keyCode : undefined);
					dispatch.key(event);
				},
				(direction) => {
					dispatch.cancel();
					if (!target.current) return;
					void window.quakeKeyLibrary?.request({
						type: "navigate",
						deviceId: target.current.deviceId,
						direction,
					});
				},
				() => {
					dispatch.cancel();
					setPressedKeyCode(undefined);
				},
			);
	}, []);
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const profiles = useStripProfiles();
	const { settings } = useStripSettings();
	if (profiles._tag === "ready") {
		const { profile, page } = selectStripPage(
			profiles.envelope,
			snapshot?.saved.serial,
		);
		target.current = {
			deviceId: snapshot?.saved.serial ?? "desktop-preview",
			profileId: profile.id,
			pageId: page.id,
			revision: profile.revision,
		};
	} else target.current = undefined;
	return (
		<main className="strip-panel" aria-label="Quake device panel">
			<StripViewport>
				<StripScreen
					onLayout={onLayout}
					pressedKeyCode={pressedKeyCode}
					profiles={profiles}
					wallpaper={snapshot}
					showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
				>
					<PanelFeedbackLayer view={feedback} />
					<KnobPanelLayer />
				</StripScreen>
			</StripViewport>
		</main>
	);
}

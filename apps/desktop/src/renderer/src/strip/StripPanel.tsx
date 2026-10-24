import { Either, Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingAction } from "../../../shared/meeting-bridge";
import { meetingRequest } from "../meetings/useMeetings";
import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "../wallpaper/useWallpaper";
import type { StripLayout } from "./geometry";
import { mountStripTouch } from "./mount-strip-touch";
import { KnobPanelLayer } from "./overlays/knob/KnobPanelLayer";
import { StripScreen, StripViewport } from "./StripScreen";
import { useStripSettings } from "./stripSettings";
import { useStripProfiles } from "./useStripProfiles";

/**
 * The `?surface=panel` window: the active profile's key grid on the QUAKE
 * strip, with touch bound to its rendered layout and feedback above it.
 */
export function StripPanel(): React.JSX.Element {
	const layout = useRef<StripLayout | undefined>(undefined);
	const [pressedKeyCode, setPressedKeyCode] = useState<string>();
	const onLayout = useCallback((current: StripLayout | undefined) => {
		layout.current = current;
	}, []);
	useEffect(() => {
		const root = document.getElementById("root");
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
					if (event.keyAction !== 1) return;
					const tile = layout.current?.tiles.find(
						(tile) => tile.keyCode === event.keyCode,
					);
					if (
						!tile ||
						(tile.type === "mic" && tile.cellTheme !== "meetingAssistantTheme")
					)
						return;
					const action = Schema.decodeUnknownEither(MeetingAction)(tile.type);
					if (Either.isRight(action))
						void meetingRequest({ _tag: "action", action: action.right });
				},
			);
	}, []);
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const profiles = useStripProfiles();
	const { settings } = useStripSettings();
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

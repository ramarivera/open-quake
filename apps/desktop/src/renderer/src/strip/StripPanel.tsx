import { useCallback, useEffect, useRef, useState } from "react";
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
	const selection = useRef<
		| {
				profileId: string;
				pageId: string;
				emojiKeys: readonly string[];
		  }
		| undefined
	>(undefined);
	const layout = useRef<StripLayout | undefined>(undefined);
	const [pressedKeyCode, setPressedKeyCode] = useState<string>();
	const onLayout = useCallback((current: StripLayout | undefined) => {
		layout.current = current;
	}, []);
	useEffect(() => {
		const root = document.getElementById("root");
		const timers = new Set<ReturnType<typeof setTimeout>>();
		let disposed = false;
		const invalid = (keyCode: string): void => {
			if (disposed || !root) return;
			const tile = Array.from(
				root.querySelectorAll<HTMLElement>(
					'[data-state="tile"][data-key-code]',
				),
			).find((tile) => tile.dataset.keyCode === keyCode);
			if (!tile) return;
			tile.dataset.invalid = "true";
			const timer = setTimeout(() => {
				delete tile.dataset.invalid;
				timers.delete(timer);
			}, 160);
			timers.add(timer);
		};
		if (root && window.openQuake) {
			const off = mountStripTouch(
				root,
				window.openQuake,
				Number(new URLSearchParams(location.search).get("rotation") ?? 0),
				() => layout.current,
				(event) => {
					setPressedKeyCode(event.keyAction === 0 ? event.keyCode : undefined);
					const current = selection.current;
					if (!current?.emojiKeys.includes(event.keyCode)) return;
					void window.quakeEmoji
						?.press({
							profileId: current.profileId,
							pageId: current.pageId,
							keyCode: event.keyCode,
							keyAction: event.keyAction,
						})
						.then((reply) => {
							if (reply._tag === "invalid") invalid(event.keyCode);
						})
						.catch(() => invalid(event.keyCode));
				},
			);
			return () => {
				disposed = true;
				off();
				for (const timer of timers) clearTimeout(timer);
			};
		}
	}, []);
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const profiles = useStripProfiles();
	if (profiles._tag === "ready") {
		const current = selectStripPage(profiles.envelope, snapshot?.saved.serial);
		selection.current = {
			profileId: current.profile.id,
			pageId: current.page.id,
			emojiKeys: current.page.keys
				.filter((key) => key.config.type === "emoji")
				.map((key) => key.keyCode),
		};
	} else selection.current = undefined;
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

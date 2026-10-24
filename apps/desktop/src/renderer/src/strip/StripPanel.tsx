import { Option } from "effect";
import { useEffect, useRef } from "react";
import type { GridVoiceInput } from "../../../shared/voice-surface";
import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "../wallpaper/useWallpaper";
import type { StripLayout } from "./geometry";
import { KeyAlert } from "./overlays/voice/KeyDecorations";
import { holdKeyOf, useVoiceSurface } from "./overlays/voice/useVoiceSurface";
import { StripToasts, VoiceOverlay } from "./overlays/voice/VoiceOverlay";
import { useStripMotion } from "./overlays/voice/voice-context";
import { StripScreen, StripViewport, useStripLayout } from "./StripScreen";
import { selectStripPage } from "./selection";
import { useStripSettings } from "./stripSettings";
import { useStripProfiles } from "./useStripProfiles";

type Send = (input: GridVoiceInput) => void;

/**
 * Hold-to-talk input for aiChat/clawbot tiles. strip-touch-input (PR #20)
 * dispatches `quake-strip-key` on this root; the pointer path serves the mouse
 * and OS touch (SCREEN-060). GridVoice in main applies every timing rule.
 */
function useHoldInput(
	root: React.RefObject<HTMLElement | null>,
	layout: StripLayout | undefined,
	send: Send,
): void {
	const latest = useRef({ layout, send });
	latest.current = { layout, send };
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		const holdKey = (keyCode: string) =>
			Option.flatMap(
				Option.fromNullable(
					latest.current.layout?.tiles.find((tile) => tile.keyCode === keyCode),
				),
				holdKeyOf,
			);
		const input = (
			keyCode: string,
			kind: GridVoiceInput["kind"],
			extra: Partial<GridVoiceInput> = {},
		): void => {
			const key = holdKey(keyCode);
			if (Option.isNone(key)) return;
			latest.current.send({
				keyCode,
				kind,
				type: key.value.type,
				...Option.match(key.value.agentId, {
					onNone: () => ({}),
					onSome: (agentId) => ({ agentId }),
				}),
				...extra,
			});
		};
		let pressed: string | undefined;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			const keyCode = target?.closest<HTMLElement>(
				'.strip-slot[data-state="tile"]',
			)?.dataset.keyCode;
			if (!keyCode || Option.isNone(holdKey(keyCode))) return;
			pressed = keyCode;
			input(keyCode, "down");
		};
		const onPointerUp = (event: PointerEvent): void => {
			if (!pressed) return;
			input(
				pressed,
				event.type === "pointercancel" ? "touchCancel" : "touchEnd",
			);
			pressed = undefined;
		};
		const onStripKey = (event: Event): void => {
			if (!(event instanceof CustomEvent)) return;
			const detail: unknown = event.detail;
			if (typeof detail !== "object" || detail === null) return;
			const keyCode = "keyCode" in detail ? detail.keyCode : undefined;
			const action = "keyAction" in detail ? detail.keyAction : undefined;
			const touchEnd =
				"voiceTouchEnd" in detail && detail.voiceTouchEnd === true;
			if (typeof keyCode !== "string") return;
			if (action === 0) input(keyCode, "down");
			else if (action === 1 && touchEnd) input(keyCode, "touchEnd");
		};
		element.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
		element.addEventListener("quake-strip-key", onStripKey);
		return () => {
			element.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
			element.removeEventListener("quake-strip-key", onStripKey);
		};
	}, [root]);
}

/**
 * The `?surface=panel` window: the active profile's key grid on the QUAKE
 * strip, with the existing knob/touch feedback drawn above it until the knob
 * and touch lanes replace that layer, and the voice overlay on top.
 */
export function StripPanel(): React.JSX.Element {
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const profiles = useStripProfiles();
	const { settings } = useStripSettings();
	const serial = snapshot?.saved.serial;
	const layout = useStripLayout(profiles, serial);
	const voice = useVoiceSurface(layout);
	const motion = useStripMotion();
	const root = useRef<HTMLElement>(null);
	const { request, view } = voice.context;
	useHoldInput(root, layout, (input) => {
		void request({ _tag: "Input", input });
	});
	// A profile or page switch drops the voice session's key state (AI-170).
	const selection =
		profiles._tag === "ready"
			? (() => {
					const { profile, page } = selectStripPage(profiles.envelope, serial);
					return `${profile.id}/${page.id}`;
				})()
			: undefined;
	const previous = useRef(selection);
	const { dispatch } = voice;
	useEffect(() => {
		if (previous.current === selection) return;
		const changed = previous.current !== undefined;
		previous.current = selection;
		if (!changed) return;
		dispatch({ _tag: "profileReset" });
		void request({ _tag: "Reset", reason: "profileChanged" });
	}, [selection, dispatch, request]);
	return (
		<main ref={root} className="strip-panel" aria-label="Quake device panel">
			<StripViewport>
				<StripScreen
					profiles={profiles}
					wallpaper={snapshot}
					showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
					voice={{
						...voice.context,
						surface: "panel",
						motion,
						wheelOpen: false,
					}}
					tileOverlay={(tile) => {
						const alert = view.alerts.get(tile.keyCode);
						return alert ? <KeyAlert alert={alert.alert} /> : null;
					}}
					htmlOverlay={
						<>
							<VoiceOverlay
								view={view}
								locale={voice.context.locale}
								motion={motion}
							/>
							<StripToasts view={view} locale={voice.context.locale} />
						</>
					}
				>
					<PanelFeedbackLayer view={feedback} />
				</StripScreen>
			</StripViewport>
		</main>
	);
}

import { Option } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GridVoiceInput } from "../../../shared/voice-surface";
import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "../wallpaper/useWallpaper";
import type { StripLayout } from "./geometry";
import { mountStripTouch } from "./mount-strip-touch";
import { KnobPanelLayer } from "./overlays/knob/KnobPanelLayer";
import { useKnob } from "./overlays/knob/useKnob";
import { KeyAlert } from "./overlays/voice/KeyDecorations";
import { holdKeyOf, useVoiceSurface } from "./overlays/voice/useVoiceSurface";
import { StripToasts, VoiceOverlay } from "./overlays/voice/VoiceOverlay";
import { useStripMotion } from "./overlays/voice/voice-context";
import { StripScreen, StripViewport, useStripLayout } from "./StripScreen";
import { selectStripPage } from "./selection";
import { useStripSettings } from "./stripSettings";
import type { StripKeyEvent } from "./touch-controller";
import { useStripProfiles } from "./useStripProfiles";

type HoldKind = GridVoiceInput["kind"];

/**
 * Hold-to-talk input for aiChat/clawbot tiles: strip-touch's key events
 * (down on touch, up with `voiceTouchEnd` on release) and, for the mouse and
 * OS touch, pointer events on the panel (SCREEN-060). GridVoice in main
 * applies every timing rule.
 */
function useHoldInput(
	root: React.RefObject<HTMLElement | null>,
	layout: StripLayout | undefined,
	send: (input: GridVoiceInput) => void,
): (event: StripKeyEvent) => void {
	const latest = useRef({ layout, send });
	latest.current = { layout, send };
	const input = useCallback((keyCode: string, kind: HoldKind): void => {
		const key = Option.flatMap(
			Option.fromNullable(
				latest.current.layout?.tiles.find((tile) => tile.keyCode === keyCode),
			),
			holdKeyOf,
		);
		if (Option.isNone(key)) return;
		latest.current.send({
			keyCode,
			kind,
			type: key.value.type,
			...Option.match(key.value.agentId, {
				onNone: () => ({}),
				onSome: (agentId) => ({ agentId }),
			}),
		});
	}, []);
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		let pressed: string | undefined;
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			const keyCode = target?.closest<HTMLElement>(
				'.strip-slot[data-state="tile"]',
			)?.dataset.keyCode;
			if (!keyCode) return;
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
		element.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);
		return () => {
			element.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		};
	}, [root, input]);
	return useCallback(
		(event: StripKeyEvent): void => {
			if (event.keyAction === 0) input(event.keyCode, "down");
			else if (event.voiceTouchEnd) input(event.keyCode, "touchEnd");
		},
		[input],
	);
}

/**
 * The `?surface=panel` window: the active profile's key grid on the QUAKE
 * strip, with touch bound to its rendered layout, feedback above it, and the
 * voice overlay on top (strip-voice-ui).
 */
export function StripPanel(): React.JSX.Element {
	const layout = useRef<StripLayout | undefined>(undefined);
	const [pressedKeyCode, setPressedKeyCode] = useState<string>();
	const onLayout = useCallback((current: StripLayout | undefined) => {
		layout.current = current;
	}, []);
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const profiles = useStripProfiles();
	const { settings } = useStripSettings();
	const serial = snapshot?.saved.serial;
	const stripLayout = useStripLayout(profiles, serial);
	const voice = useVoiceSurface(stripLayout);
	const motion = useStripMotion();
	// Chat cards go opaque while the FunctionWheel or picker is open (AI-207).
	const knobSelector = useKnob().snapshot?.selector.mode;
	const wheelOpen = knobSelector !== undefined && knobSelector !== "closed";
	const main = useRef<HTMLElement>(null);
	const { request, view, locale } = voice.context;
	const onHoldKey = useHoldInput(main, stripLayout, (input) => {
		void request({ _tag: "Input", input });
	});
	const holdKey = useRef(onHoldKey);
	holdKey.current = onHoldKey;
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
					holdKey.current(event);
				},
			);
	}, []);
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
		<main ref={main} className="strip-panel" aria-label="Quake device panel">
			<StripViewport>
				<StripScreen
					onLayout={onLayout}
					pressedKeyCode={pressedKeyCode}
					profiles={profiles}
					wallpaper={snapshot}
					showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
					voice={{
						...voice.context,
						surface: "panel",
						motion,
						wheelOpen,
					}}
					tileOverlay={(tile) => {
						const alert = view.alerts.get(tile.keyCode);
						return alert ? <KeyAlert alert={alert.alert} /> : null;
					}}
					htmlOverlay={
						<>
							<VoiceOverlay view={view} locale={locale} motion={motion} />
							<StripToasts view={view} locale={locale} />
						</>
					}
				>
					<PanelFeedbackLayer view={feedback} />
					<KnobPanelLayer />
				</StripScreen>
			</StripViewport>
		</main>
	);
}

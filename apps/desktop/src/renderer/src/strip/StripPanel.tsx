import { Option } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GridVoiceInput } from "../../../shared/voice-surface";
import {
	createPanelKeyDispatcher,
	type PanelKeyTarget,
} from "../keys/panel-key-dispatch";
import { meetingTouchAction } from "../meetings/touch-action";
import { meetingRequest } from "../meetings/useMeetings";
import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "../wallpaper/useWallpaper";
import type { StripLayout } from "./geometry";
import { mountStripTouch } from "./mount-strip-touch";
import { KnobPanelLayer } from "./overlays/knob/KnobPanelLayer";
import { useKnob } from "./overlays/knob/useKnob";
import { KeyAlert } from "./overlays/voice/KeyDecorations";
import {
	useVoiceSurface,
	voiceInputOf,
} from "./overlays/voice/useVoiceSurface";
import { StripToasts, VoiceOverlay } from "./overlays/voice/VoiceOverlay";
import { useStripMotion } from "./overlays/voice/voice-context";
import { StripScreen, StripViewport, useStripLayout } from "./StripScreen";
import { selectStripPage } from "./selection";
import { useStripSettings } from "./stripSettings";
import type { StripKeyEvent } from "./touch-controller";
import { type StripProfiles, useStripProfiles } from "./useStripProfiles";

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
			(tile) => voiceInputOf(tile, kind),
		);
		if (Option.isNone(key)) return;
		latest.current.send(key.value);
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
			else
				input(event.keyCode, event.voiceTouchEnd ? "touchEnd" : "touchCancel");
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
	const target = useRef<PanelKeyTarget | undefined>(undefined);
	const emojiSelection = useRef<
		| {
				profileId: string;
				pageId: string;
				emojiKeys: readonly string[];
				generation: symbol;
		  }
		| undefined
	>(undefined);
	const layout = useRef<StripLayout | undefined>(undefined);
	const [pressedKeyCode, setPressedKeyCode] = useState<string>();
	const onLayout = useCallback((current: StripLayout | undefined) => {
		layout.current = current;
	}, []);
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	const observeSelection = (next: StripProfiles): void => {
		if (next._tag === "ready") {
			const current = selectStripPage(next.envelope, snapshot?.saved.serial);
			const previous = emojiSelection.current;
			emojiSelection.current = {
				profileId: current.profile.id,
				pageId: current.page.id,
				generation:
					previous?.profileId === current.profile.id &&
					previous.pageId === current.page.id
						? previous.generation
						: Symbol(),
				emojiKeys: current.page.keys
					.filter((key) => key.config.type === "emoji")
					.map((key) => key.keyCode),
			};
		} else emojiSelection.current = undefined;
	};
	const profiles = useStripProfiles(observeSelection);
	observeSelection(profiles);
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
		const dispatch = createPanelKeyDispatcher(
			() => target.current,
			(request) => window.quakeKeyLibrary.request(request),
		);
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const heldEmoji = new Map<
			string,
			NonNullable<typeof emojiSelection.current>
		>();
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
					dispatch.key(event);
					holdKey.current(event);
					const action = meetingTouchAction(event, layout.current);
					if (action) void meetingRequest({ _tag: "action", action });
					const current = emojiSelection.current;
					if (event.keyAction === 0) {
						if (current?.emojiKeys.includes(event.keyCode))
							heldEmoji.set(event.keyCode, current);
						else heldEmoji.delete(event.keyCode);
						return;
					}
					const owner = heldEmoji.get(event.keyCode);
					heldEmoji.delete(event.keyCode);
					if (
						!event.voiceTouchEnd ||
						!owner ||
						owner.generation !== current?.generation
					)
						return;
					void window.quakeEmoji
						?.press({
							profileId: owner.profileId,
							pageId: owner.pageId,
							keyCode: event.keyCode,
							keyAction: event.keyAction,
						})
						.then((reply) => {
							if (reply._tag === "invalid") invalid(event.keyCode);
						})
						.catch(() => invalid(event.keyCode));
				},
				(direction) => {
					dispatch.cancel();
					heldEmoji.clear();
					if (!target.current) return;
					void window.quakeKeyLibrary?.request({
						type: "navigate",
						deviceId: target.current.deviceId,
						direction,
					});
				},
				() => {
					dispatch.cancel();
					heldEmoji.clear();
					setPressedKeyCode(undefined);
				},
			);
			return () => {
				disposed = true;
				off();
				for (const timer of timers) clearTimeout(timer);
			};
		}
	}, []);
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

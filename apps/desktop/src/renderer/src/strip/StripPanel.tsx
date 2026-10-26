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
import { createStripResourceReceiver } from "./device-resources";
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
import { useDeviceReady } from "./useDeviceReady";
import { type StripProfiles, useStripProfiles } from "./useStripProfiles";

type HoldKind = GridVoiceInput["kind"];

/**
 * Hold-to-talk input for aiChat/clawbot tiles: strip-touch's key events
 * (down on touch, up with `voiceTouchEnd` on release) and, for the mouse and
 * OS touch, pointer events on the panel (SCREEN-060). GridVoice in main
 * applies every timing rule.
 */
function useHoldInput(
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
function ActiveStripPanel(): React.JSX.Element {
	const target = useRef<PanelKeyTarget | undefined>(undefined);
	const emojiSelection = useRef<
		| {
				profileId: string;
				pageId: string;
				revision: number;
				emojiKeys: readonly string[];
				generation: symbol;
		  }
		| undefined
	>(undefined);
	const layout = useRef<StripLayout | undefined>(undefined);
	const [pressedKeyCode, setPressedKeyCode] = useState<string>();
	const committedLayoutIdentity = useRef<string | undefined>(undefined);
	const { snapshot } = useWallpaper();
	const serial =
		new URLSearchParams(window.location.search).get("serial") ??
		snapshot?.saved.serial;
	const feedback = usePanelFeedback(useQuakeEvents());
	const observeSelection = (next: StripProfiles): void => {
		if (next._tag === "ready") {
			const current = selectStripPage(next.envelope, serial);
			const previous = emojiSelection.current;
			emojiSelection.current = {
				profileId: current.profile.id,
				pageId: current.page.id,
				revision: current.profile.revision,
				generation:
					previous?.profileId === current.profile.id &&
					previous.pageId === current.page.id &&
					previous.revision === current.profile.revision
						? previous.generation
						: Symbol(),
				emojiKeys: current.page.keys
					.filter((key) => key.config.type === "emoji")
					.map((key) => key.keyCode),
			};
		} else emojiSelection.current = undefined;
	};
	const profiles = useStripProfiles(observeSelection, serial);
	const deviceReady = useDeviceReady(serial, profiles);
	const layoutIdentity =
		profiles._tag === "ready"
			? (() => {
					const { profile, page } = selectStripPage(profiles.envelope, serial);
					return JSON.stringify([
						serial,
						profile.id,
						page.id,
						profile.revision,
						deviceReady.snapshot?.keyMatrix.row,
					]);
				})()
			: undefined;
	const [rawImages, setRawImages] = useState<Readonly<Record<string, string>>>(
		{},
	);
	useEffect(() => {
		setRawImages({});
		if (!serial || !deviceReady.snapshot?.session || !layoutIdentity) return;
		const receiver = createStripResourceReceiver((key, dataUrl) =>
			setRawImages((old) => ({ ...old, [key]: dataUrl })),
		);
		const off = window.openQuake?.onQuakeEvent(receiver.accept);
		return () => {
			off?.();
			receiver.reset();
		};
	}, [serial, deviceReady.snapshot?.session, layoutIdentity]);
	observeSelection(profiles);
	const { settings } = useStripSettings();
	const stripLayout = useStripLayout(
		profiles,
		serial,
		deviceReady.snapshot?.keyMatrix.row,
	);
	const onLayout = useCallback(
		(current: StripLayout | undefined) => {
			if (current) {
				// StripScreen clears its layout before replacement and also repaints
				// runtime state. Compare committed keys, retaining identity across cleanup.
				const identity = JSON.stringify([
					layoutIdentity,
					stripLayout?.tiles.map((tile) => tile.key),
				]);
				if (
					committedLayoutIdentity.current !== undefined &&
					committedLayoutIdentity.current !== identity
				)
					document
						.getElementById("root")
						?.dispatchEvent(new Event("quake-strip-reset"));
				committedLayoutIdentity.current = identity;
			}
			layout.current = current;
		},
		[stripLayout, layoutIdentity],
	);
	const voice = useVoiceSurface(stripLayout);
	const motion = useStripMotion();
	// Chat cards go opaque while the FunctionWheel or picker is open (AI-207).
	const knobSelector = useKnob().snapshot?.selector.mode;
	const wheelOpen = knobSelector !== undefined && knobSelector !== "closed";
	const main = useRef<HTMLElement>(null);
	const { request, view, locale } = voice.context;
	const onHoldKey = useHoldInput(stripLayout, (input) => {
		void request({ _tag: "Input", input });
	});
	const holdKey = useRef(onHoldKey);
	holdKey.current = onHoldKey;
	useEffect(() => {
		const root = document.getElementById("root");
		const dispatch = createPanelKeyDispatcher(
			() => target.current,
			(request) => window.quakeKeyLibrary.request(request),
			// A matrix replacement releases the previous key before acquiring the next.
			"device",
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
		let matrixKey: string | undefined;
		const handleKey = (event: StripKeyEvent): void => {
			if (event.keyAction === 1 && matrixKey === event.keyCode)
				matrixKey = undefined;
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
		};
		const cancel = (): void => {
			if (matrixKey) holdKey.current({ keyCode: matrixKey, keyAction: 1 });
			matrixKey = undefined;
			dispatch.cancel();
			heldEmoji.clear();
			setPressedKeyCode(undefined);
		};
		const offMatrix = window.openQuake?.onQuakeEvent((event) => {
			if (event.kind !== "matrix") return;
			const index = event.matrix.states.indexOf(1);
			const keyCode =
				index < 0
					? undefined
					: `${Math.floor(index / 5) + 1},${(index % 5) + 1}`;
			if (matrixKey === keyCode) return;
			// Legacy frames contain state, not edges. Preserve holds until that state changes.
			if (matrixKey)
				handleKey({ keyAction: 1, keyCode: matrixKey, voiceTouchEnd: true });
			if (
				!keyCode ||
				!layout.current?.tiles.some((tile) => tile.keyCode === keyCode)
			)
				return;
			matrixKey = keyCode;
			handleKey({ keyAction: 0, keyCode });
		});
		if (root && window.openQuake) {
			const off = mountStripTouch(
				root,
				window.openQuake,
				Number(new URLSearchParams(location.search).get("rotation") ?? 0),
				() => layout.current,
				handleKey,
				undefined,
				cancel,
			);
			return () => {
				disposed = true;
				offMatrix?.();
				off();
				for (const timer of timers) clearTimeout(timer);
			};
		}
		return () => {
			offMatrix?.();
			cancel();
		};
	}, []);
	if (profiles._tag === "ready") {
		const { profile, page } = selectStripPage(profiles.envelope, serial);
		target.current = {
			deviceId: serial ?? "desktop-preview",
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
		document
			.getElementById("root")
			?.dispatchEvent(new Event("quake-strip-reset"));
		dispatch({ _tag: "profileReset" });
		void request({ _tag: "Reset", reason: "profileChanged" });
	}, [selection, dispatch, request]);
	return (
		<main ref={main} className="strip-panel" aria-label="Quake device panel">
			<StripViewport>
				<StripScreen
					{...(serial === undefined ? {} : { previewSerial: serial })}
					rows={deviceReady.snapshot?.keyMatrix.row ?? 2}
					onLayout={onLayout}
					pressedKeyCode={pressedKeyCode}
					profiles={profiles}
					wallpaper={snapshot}
					wallpaperSound
					showEmptyGridDashedBorder={settings.showEmptyGridDashedBorder}
					voice={{
						...voice.context,
						surface: "panel",
						motion,
						wheelOpen,
					}}
					tileOverlay={(tile) => {
						const alert = view.alerts.get(tile.keyCode);
						return (
							<>
								{rawImages[tile.keyCode] ? (
									<img
										src={rawImages[tile.keyCode]}
										alt=""
										draggable={false}
										style={{
											position: "absolute",
											inset: 0,
											width: "100%",
											height: "100%",
											objectFit: "cover",
											pointerEvents: "none",
										}}
									/>
								) : null}
								{alert ? <KeyAlert alert={alert.alert} /> : null}
							</>
						);
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

/** Window lifecycle unmounts every panel hook and child resource together. */
export function StripPanel(): React.JSX.Element | null {
	const [active, setActive] = useState(true);
	useEffect(() => {
		const hide = () => setActive(false);
		window.addEventListener("pagehide", hide);
		window.addEventListener("beforeunload", hide);
		return () => {
			window.removeEventListener("pagehide", hide);
			window.removeEventListener("beforeunload", hide);
		};
	}, []);
	return active ? <ActiveStripPanel /> : null;
}

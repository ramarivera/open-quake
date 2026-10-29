import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import { selectorProfiles } from "../../../../../shared/knob-contracts";
import { VoiceSurfaceEvent } from "../../../../../shared/voice-surface";
import { useLocaleText } from "../../../i18n";
import { stripLayout } from "../../geometry";
import { useStripProfiles } from "../../useStripProfiles";
import { useStripMotion } from "../voice/voice-context";
import { FunctionWheel } from "./FunctionWheel";
import { focusTargetRect } from "./geometry";
import { KnobDial } from "./KnobDial";
import { useKnob } from "./useKnob";
import { VolumeCapsule } from "./VolumeCapsule";
import "./knob.css";

/** SVG child of the strip canvas, so rotation/scaling match the base panel. */
export function KnobPanelLayer(): React.JSX.Element | null {
	const { snapshot, notice, request } = useKnob();
	const t = useLocaleText("picker");
	const motion = useStripMotion();
	const profiles = useStripProfiles();
	const capture = useRef<
		| {
				captureId: string;
				sessionId: string;
				keyCode: string;
				generation: number;
		  }
		| undefined
	>(undefined);
	useEffect(() => {
		if (!snapshot) return;
		const sessionId = snapshot.context.session.sessionId;
		const root = document.getElementById("root");
		const tap = (event: Event): void => {
			if (!(event instanceof CustomEvent)) return;
			const detail: unknown = event.detail;
			if (
				typeof detail !== "object" ||
				detail === null ||
				!("keyCode" in detail) ||
				typeof detail.keyCode !== "string"
			)
				return;
			void request({
				_tag: "TapTile",
				sessionId,
				keyCode: detail.keyCode,
			});
		};
		root?.addEventListener("quake-strip-tile-tap", tap);
		const off = window.quakeVoice?.onEvent((value) => {
			if (
				!Schema.is(VoiceSurfaceEvent)(value) ||
				value._tag !== "Stage" ||
				value.serial !== snapshot.context.session.deviceId
			)
				return;
			if (
				value.stage._tag === "recording" ||
				value.stage._tag === "processing"
			) {
				if (capture.current?.captureId === value.captureId) return;
				capture.current =
					snapshot.focus._tag === "tile" &&
					snapshot.focus.generation !== undefined
						? {
								captureId: value.captureId,
								sessionId,
								keyCode: snapshot.focus.keyCode,
								generation: snapshot.focus.generation,
							}
						: undefined;
			} else if (
				value.stage._tag === "idle" &&
				capture.current?.captureId === value.captureId
			) {
				const { captureId: _captureId, ...identity } = capture.current;
				capture.current = undefined;
				void request({ _tag: "RestoreFocus", ...identity });
			}
		});
		return () => {
			root?.removeEventListener("quake-strip-tile-tap", tap);
			off?.();
		};
	}, [snapshot, request]);
	if (!snapshot) return null;
	const { context, selector, focus, volume } = snapshot;
	const sessionId = context.session.sessionId;
	const entries = selectorProfiles(snapshot);
	const focusedKind =
		focus._tag === "tile"
			? context.keys.find((key) => key.keyCode === focus.keyCode)?.kind
			: undefined;
	const errorMessage =
		snapshot.notice === "QUAKE.KNOB.CAPABILITY_UNAVAILABLE" &&
		focusedKind === "brightness"
			? t("hostBrightnessUnsupported")
			: notice || (snapshot.notice ? t("controlUnavailable") : "");
	const profile =
		profiles._tag === "ready"
			? profiles.envelope.profiles.find(
					(p) => p.id === context.session.profileId,
				)
			: undefined;
	const page =
		profile?.pages.find((page) => page.id === context.pageId) ??
		profile?.pages[0];
	const layout = profile && page ? stripLayout(profile, page) : undefined;
	return (
		<foreignObject
			x="0"
			y="0"
			width="1920"
			height="480"
			className="knob-panel-layer"
		>
			<div
				className="knob-overlay-root"
				data-session={sessionId}
				data-mode={selector.mode}
				data-index={selector.index}
				data-page={selector.page}
			>
				{context.keys
					.filter((key) => key.visible)
					.flatMap((key) => {
						const rect = focusTargetRect(key, layout);
						if (!rect) return [];
						return (
							<button
								key={key.keyCode}
								type="button"
								aria-label={`Knob focus ${key.kind}`}
								aria-pressed={
									focus._tag === "tile" && focus.keyCode === key.keyCode
								}
								className="knob-tile-target"
								style={{
									left: rect.x,
									top: rect.y,
									width: rect.width,
									height: rect.height,
								}}
								onClick={() => {
									void request({
										_tag: "TapTile",
										sessionId,
										keyCode: key.keyCode,
									});
								}}
							>
								{focus._tag === "tile" && focus.keyCode === key.keyCode ? (
									<KnobDial
										width={rect.width}
										height={rect.height}
										angle={focus.angle}
									/>
								) : null}
							</button>
						);
					})}
				{context.player ? (
					<div className="knob-volume-position">
						<VolumeCapsule
							volume={volume}
							toggle={() => {
								void request({ _tag: "ToggleVolume", sessionId });
							}}
						/>
					</div>
				) : null}
				{selector.ringVisible && entries.length ? (
					<FunctionWheel
						entries={entries}
						activeId={context.session.profileId}
						index={selector.index}
						direction={selector.direction}
						motion={motion}
					/>
				) : null}
				<KnobNotice message={errorMessage} />
			</div>
		</foreignObject>
	);
}

function KnobNotice({
	message,
}: {
	message: string;
}): React.JSX.Element | null {
	const [view, setView] = useState({ text: message, exiting: false });
	useEffect(() => {
		if (message) {
			setView({ text: message, exiting: false });
			return;
		}
		setView((current) =>
			current.text ? { ...current, exiting: true } : current,
		);
		const timer = setTimeout(() => setView({ text: "", exiting: false }), 240);
		return () => clearTimeout(timer);
	}, [message]);
	return view.text ? (
		<div className="knob-notice" role="status" data-exiting={view.exiting}>
			{view.text}
		</div>
	) : null;
}

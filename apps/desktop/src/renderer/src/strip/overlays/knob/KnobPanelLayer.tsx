import { useEffect } from "react";
import { selectorProfiles } from "../../../../../shared/knob-contracts";
import { stripLayout } from "../../geometry";
import { useStripProfiles } from "../../useStripProfiles";
import { FunctionWheel } from "./FunctionWheel";
import { focusTargetRect } from "./geometry";
import { KnobDial } from "./KnobDial";
import { ProfilePicker } from "./ProfilePicker";
import { useKnob } from "./useKnob";
import { VolumeCapsule } from "./VolumeCapsule";
import "./knob.css";

/** SVG child of the strip canvas, so rotation/scaling match the base panel. */
export function KnobPanelLayer(): React.JSX.Element | null {
	const { snapshot, notice, request } = useKnob();
	const profiles = useStripProfiles();
	useEffect(() => {
		if (snapshot?.focus._tag !== "tile" || snapshot.selector.mode !== "closed")
			return;
		const sessionId = snapshot.context.session.sessionId;
		const tap = (event: PointerEvent) => {
			if (
				!(event.target instanceof Element) ||
				event.target.closest(".knob-tile-target")
			)
				return;
			const keyCode =
				event.target.closest<HTMLElement>(".strip-slot")?.dataset.keyCode;
			if (keyCode) void request({ _tag: "TapTile", sessionId, keyCode });
		};
		window.addEventListener("pointerdown", tap);
		return () => window.removeEventListener("pointerdown", tap);
	}, [snapshot, request]);
	if (!snapshot) return null;
	const { context, selector, focus, volume } = snapshot;
	const sessionId = context.session.sessionId;
	const entries = selectorProfiles(snapshot);
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
				{selector.mode === "picker" ? (
					<ProfilePicker
						snapshot={snapshot}
						entries={entries}
						request={request}
					/>
				) : null}
				{selector.mode === "ring" && selector.ringVisible && entries.length ? (
					<FunctionWheel
						entries={entries}
						index={selector.index}
						direction={selector.direction}
					/>
				) : null}
				{notice || snapshot.notice ? (
					<div className="knob-notice" role="status">
						{notice || "This control is unavailable"}
					</div>
				) : null}
			</div>
		</foreignObject>
	);
}

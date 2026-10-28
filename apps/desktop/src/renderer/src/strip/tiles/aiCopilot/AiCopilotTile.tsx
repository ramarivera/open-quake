import { Option } from "effect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../../css-properties";
import { stripText } from "../../overlays/voice/strings";
import {
	useSubTouchDrag,
	useSubTouchTap,
} from "../../overlays/voice/sub-touch";
import type { StripTileProps } from "../../tileRegistry";
import {
	type CopilotStatusText,
	copilotLayout,
	copilotTone,
	showsCancelHint,
	showsPushToTalkHint,
} from "./copilot-state";
import "./aiCopilot.css";

/** DK's one-letter highlight loop on the idle hint (ACV:1043-1076). */
function usePushToTalkHint(text: string, active: boolean): number {
	const [index, setIndex] = useState(0);
	useEffect(() => {
		setIndex(0);
		if (!active || text.length === 0) return;
		const timer = setInterval(
			() => setIndex((value) => (value + 1) % text.length),
			100,
		);
		return () => clearInterval(timer);
	}, [active, text]);
	return index;
}

/** The presence mark: an AI glyph on a ring toned by the copilot's status. */
function CopilotPresence({
	tone,
	size,
	energy,
	phase,
	motion,
}: {
	tone: string;
	size: number;
	energy: number;
	phase: string;
	motion: "full" | "reduce";
}): React.JSX.Element {
	return (
		<div
			className="copilot-presence"
			data-tone={tone}
			data-phase={phase}
			data-motion={motion}
			data-energy={energy}
			style={{ width: size, height: size, "--copilot-energy": energy }}
			aria-hidden="true"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z" />
				<path d="M18.5 15.5c.25 1.6 1 2.35 2.5 2.5-1.5.15-2.25.9-2.5 2.5-.25-1.6-1-2.35-2.5-2.5 1.5-.15 2.25-.9 2.5-2.5Z" />
			</svg>
		</div>
	);
}

/**
 * The AI Copilot view (`aiChatView`, 5×2): toolbar with a status, the presence
 * mark and the transcript (strip-voice-ui "AI Copilot view", drawn per
 * independent-device-design). Text renders as React text.
 */
export function AiCopilotTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const { view, locale, surface, motion } = context.voice;
	const state = view.copilot;
	const { width, height } = tile.box;
	const layout = copilotLayout(width, height);
	const onStrip = surface === "panel";
	const hint = onStrip && showsPushToTalkHint(state);
	const cancel = onStrip && showsCancelHint(state);
	const hintText = stripText(locale, "aiIconViewTxt.pushToTalkHint");
	const letter = usePushToTalkHint(hintText, hint && motion === "full");
	const status = Option.match(state.statusText, {
		onNone: () => "",
		onSome: (text: CopilotStatusText) =>
			text._tag === "string"
				? stripText(locale, text.key)
				: stripText(locale, "quakeBotIconView.chatFailed"),
	});
	const tone = copilotTone(state.status, state.statusText);
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new text.
	useLayoutEffect(() => {
		const element = scroller.current;
		if (element && following.current) element.scrollTop = element.scrollHeight;
	}, [state.text]);
	const onScroll = (): void => {
		const element = scroller.current;
		if (!element) return;
		const threshold = Math.max(5, Math.min(15, layout.gap * 1.5));
		following.current =
			element.scrollHeight - element.scrollTop <=
			element.clientHeight + threshold;
	};
	useSubTouchDrag(scroller);
	const copy = (): void => {
		void context.voice
			.request({ _tag: "CopyText", text: state.text })
			.then((reply) =>
				context.voice.toast(
					reply._tag === "ok"
						? "clipboard.copySuccess"
						: "clipboard.copyFailed",
				),
			);
	};
	const copyIcon = useRef<HTMLButtonElement>(null);
	useSubTouchTap(copyIcon, copy);
	const fontSize = layout.textFs * 2;
	const hintSize = layout.textFs * 1.5;
	const title = Option.getOrElse(state.activeKeyTitle, () =>
		stripText(locale, "aiIconViewTxt.cancelHint.theActiveKey"),
	);
	return (
		<div
			className="copilot"
			data-tone={tone}
			style={{
				width,
				height,
				borderRadius: tile.tileRadius,
			}}
		>
			<div
				className="copilot-toolbar"
				style={{
					height: layout.toolbar,
					padding: `0 ${Math.max(24, layout.gap)}px`,
				}}
			>
				<div className="copilot-label">
					{stripText(locale, "aiIconViewTxt.label")}
				</div>
				{status ? (
					<div className="copilot-status" data-tone={tone}>
						{status}
					</div>
				) : (
					<div className="copilot-status" />
				)}
				{onStrip && state.text.trim() !== "" ? (
					<button
						ref={copyIcon}
						type="button"
						className="copilot-copy"
						data-quake-sub-touch="copyAIChatContentIcon"
						aria-label={stripText(locale, "clipboard.copySuccess")}
						onClick={copy}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<rect x="8" y="8" width="12" height="13" rx="2" />
							<path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
						</svg>
					</button>
				) : null}
			</div>
			<div className="copilot-content" style={{ height: layout.content }}>
				<div
					className="copilot-left"
					style={{
						width: layout.left,
						padding: layout.gap,
					}}
				>
					<CopilotPresence
						tone={tone}
						energy={
							view.bar.visible ? Math.max(0, Math.min(1, view.bar.rms)) : 0
						}
						phase={
							view.bar.visible
								? "listening"
								: tone === "active"
									? "processing"
									: "idle"
						}
						motion={motion}
						size={Math.min(layout.orbWidth, layout.left - layout.gap * 2)}
					/>
				</div>
				<div
					className="copilot-right"
					style={{
						width: layout.right,
					}}
				>
					<div
						ref={scroller}
						className="copilot-scroll"
						style={{ padding: layout.gap }}
						onScroll={onScroll}
						aria-live="polite"
						data-quake-sub-touch="aiChatIconViewContent"
						data-support-quake-move="true"
					>
						{hint ? (
							<div
								className="copilot-hint"
								style={{
									minHeight: layout.content - layout.gap * 2,
									fontSize: hintSize,
									lineHeight: `${hintSize * 1.5}px`,
								}}
							>
								<span>
									{Array.from(hintText).map((character, index) => (
										<span
											// biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; position is identity.
											key={index}
											data-lit={
												(motion === "full" && index === letter) || undefined
											}
										>
											{character}
										</span>
									))}
								</span>
							</div>
						) : cancel ? (
							<div
								className="copilot-cancel"
								style={{
									minHeight: layout.content - layout.gap * 2,
									fontSize: hintSize,
									lineHeight: `${hintSize * 1.5}px`,
								}}
							>
								{stripText(locale, "aiIconViewTxt.cancelHint.pressPrefix")}
								<span className="copilot-cancel-title">{title}</span>
								{stripText(
									locale,
									"aiIconViewTxt.cancelHint.buttonToCancelSuffix",
								)}
							</div>
						) : (
							<div
								className="copilot-text"
								style={{
									fontSize,
									lineHeight: `${fontSize * 1.5}px`,
									padding: `0 ${fontSize / 2}px`,
								}}
							>
								{state.text}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

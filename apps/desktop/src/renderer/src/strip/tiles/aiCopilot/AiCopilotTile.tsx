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
	orbSpeed,
	showsCancelHint,
	showsPushToTalkHint,
} from "./copilot-state";
import { GlowEnergyOrb } from "./GlowEnergyOrb";
import "./aiCopilot.css";

/** DK's one-letter highlight loop on the idle hint (ACV:1043-1076). */
function usePushToTalkHint(length: number, active: boolean): number {
	const [index, setIndex] = useState(0);
	useEffect(() => {
		setIndex(0);
		if (!active || length === 0) return;
		const timer = setInterval(
			() => setIndex((value) => (value + 1) % length),
			100,
		);
		return () => clearInterval(timer);
	}, [active, length]);
	return index;
}

/**
 * The AI Copilot view (`aiChatView`, 5×2): toolbar, energy orb and transcript
 * (ACV, strip-voice-ui "AI Copilot view"). Text renders as React text.
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
	const letter = usePushToTalkHint(hintText.length, hint && motion === "full");
	const status = Option.match(state.statusText, {
		onNone: () => "",
		onSome: (text: CopilotStatusText) =>
			text._tag === "string"
				? stripText(locale, text.key)
				: stripText(locale, "aiIconViewTxt.errorCodeLine", { code: text.code }),
	});
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
			style={{
				width,
				height,
				borderRadius: tile.tileRadius,
				borderWidth: layout.rootBorder,
			}}
		>
			<div
				className="copilot-toolbar"
				style={{
					height: layout.toolbar,
					padding: `0 ${layout.gap}px`,
					borderBottomWidth: layout.toolbarBorder,
				}}
			>
				<div
					className="copilot-label"
					style={{ fontSize: layout.smallFs * 2, paddingLeft: width * 0.02 }}
				>
					{stripText(locale, "aiIconViewTxt.label")}
				</div>
				<div
					className="copilot-status"
					style={{ fontSize: layout.smallFs * 2 }}
				>
					{status}
				</div>
				{onStrip && state.text.trim() !== "" ? (
					<button
						ref={copyIcon}
						type="button"
						className="copilot-copy"
						data-quake-sub-touch="copyAIChatContentIcon"
						aria-label={stripText(locale, "clipboard.copySuccess")}
						onClick={copy}
					>
						<svg
							width="40"
							height="40"
							viewBox="0 0 40 40"
							fill="none"
							aria-hidden="true"
						>
							<rect width="40" height="40" rx="6" fill="rgba(0, 0, 0, 0.5)" />
							<rect
								x="10"
								y="8"
								width="16"
								height="20"
								rx="1"
								fill="rgba(117, 117, 117, 0.85)"
								opacity="0.6"
							/>
							<rect
								x="14"
								y="12"
								width="16"
								height="20"
								rx="1"
								fill="rgba(117, 117, 117, 0.85)"
							/>
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
						borderRightWidth: layout.toolbarBorder,
						boxShadow: `inset 0 0 ${layout.panelShadow}px rgba(0, 0, 0, 0.2)`,
					}}
				>
					<GlowEnergyOrb
						width={layout.orbWidth}
						height={layout.orbHeight}
						speed={orbSpeed(state.status)}
						playing={motion === "full"}
					/>
					<div className="copilot-axis" style={{ width: layout.rootBorder }} />
				</div>
				<div
					className="copilot-right"
					style={{
						width: layout.right,
						borderLeftWidth: layout.toolbarBorder,
						boxShadow: `inset 0 0 ${layout.panelShadow}px rgba(0, 0, 0, 0.2)`,
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

import { Option } from "effect";
import { useLayoutEffect, useMemo, useRef } from "react";
import "../../css-properties";
import { type StripLocale, stripText } from "../../overlays/voice/strings";
import { useSubTouchDrag } from "../../overlays/voice/sub-touch";
import type { StripTileProps } from "../../tileRegistry";
import type {
	ChatGroup,
	ChatMessage,
	ChatText,
	ConversationState,
} from "./conversation";
import { RichText } from "./RichText";
import { parseRichText } from "./rich-text";
import { ToolCard } from "./ToolCard";
import "./clawBot.css";

/** QBV getScale / useQuakeBotLayout: baseline 880×440, clamped 0.4–2.5. */
export function clawBotScale(width: number, height: number): number {
	const scale = width / height >= 2 ? height / 440 : width / 880;
	return Math.max(0.4, Math.min(2.5, scale));
}

const LOCALE_TAGS: Readonly<Record<StripLocale, string>> = {
	en: "en-US",
	zh: "zh-CN",
	de: "de-DE",
	es: "es-ES",
	fr: "fr-FR",
	it: "it-IT",
	ja: "ja-JP",
	ko: "ko-KR",
};
/** HH:mm, 24 h, in the UI locale (QBV:816-841). */
export const formatChatTime = (ts: number, locale: StripLocale): string =>
	new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(ts);

const CONNECTION_LABELS = {
	checking: "quakeBotIconView.checking",
	noService: "quakeBotIconView.noService",
	connecting: "quakeBotIconView.connecting",
	connected: "quakeBotIconView.connected",
	disconnected: "quakeBotIconView.disconnected",
} as const;

const AGENT_EMOJI: ReadonlyMap<string, string> = new Map([
	["weather", "☀️"],
	["code", "💻"],
	["chat", "💬"],
	["assistant", "🤖"],
	["system", "ℹ️"],
]);
/** Avatar emoji and gradient (QBV:680-813, AI-158). */
export function avatarFor(group: Pick<ChatGroup, "kind" | "agent">): {
	readonly emoji: string;
	readonly tone: string;
} {
	if (group.kind === "system") return { emoji: "ℹ️", tone: "system" };
	if (group.kind === "user") return { emoji: "✏️", tone: "user" };
	return {
		emoji: AGENT_EMOJI.get(group.agent.id) ?? "🤖",
		tone: `agent-${group.agent.icon}`,
	};
}

const chatText = (locale: StripLocale, text: ChatText): string =>
	text._tag === "literal"
		? text.text
		: text.copy._tag === "string"
			? stripText(locale, text.copy.key)
			: stripText(locale, "aiIconViewTxt.errorCodeLine", {
					code: text.copy.code,
				});

function senderLabel(
	locale: StripLocale,
	group: ChatGroup,
	message: ChatMessage,
): string {
	if (message._tag === "tool") return `🔧 ${message.name}`;
	if (message._tag === "text" && message.isVoice)
		return stripText(locale, "quakeBotIconView.voiceInput");
	if (group.kind === "system")
		return stripText(locale, "quakeBotIconView.systemSender");
	const agent = group.agent.name || group.agent.id;
	if (group.kind === "user")
		return `${stripText(locale, "quakeBotIconView.userOutgoing")} · ${agent}`;
	return agent;
}

function Messages({
	state,
	locale,
	scale,
	onOpen,
}: {
	state: ConversationState;
	locale: StripLocale;
	scale: number;
	onOpen: (url: string) => void;
}): React.JSX.Element {
	const area = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const firstBatch = useRef(state.groups.length);
	useSubTouchDrag(area);
	const live = Option.getOrUndefined(state.live);
	const lastText = state.groups.at(-1)?.messages.at(-1);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new content.
	useLayoutEffect(() => {
		const element = area.current;
		if (element && following.current) element.scrollTop = element.scrollHeight;
	}, [state.groups.length, lastText, live?.transcript.text]);
	const onScroll = (): void => {
		const element = area.current;
		if (!element) return;
		const threshold = Math.max(5, Math.min(15, 8 * scale));
		following.current =
			element.scrollHeight - element.scrollTop <=
			element.clientHeight + threshold;
	};
	const bubble = (
		index: number,
		count: number,
		variant: string | undefined,
	) => {
		const last = index === count - 1;
		return {
			className: "clawbot-bubble",
			"data-variant": variant,
			style: {
				padding: variant === "tool" ? 0 : `${12 * scale}px ${16 * scale}px`,
				borderRadius: `${8 * scale}px ${20 * scale}px ${20 * scale}px ${(last ? 20 : 8) * scale}px`,
				fontSize: 22 * scale,
			},
		};
	};
	const row = (
		key: string,
		avatar: { emoji: string; tone: string },
		index: number,
		children: React.ReactNode,
	) => (
		<div
			key={key}
			className="clawbot-group"
			style={{
				gap: 14 * scale,
				animationDelay:
					index < firstBatch.current ? `${index * 0.05}s` : undefined,
			}}
		>
			<div
				className="clawbot-avatar"
				data-tone={avatar.tone}
				style={{
					width: 44 * scale,
					height: 44 * scale,
					borderRadius: 12 * scale,
					fontSize: 20 * scale,
				}}
			>
				{avatar.emoji}
			</div>
			<div className="clawbot-column" style={{ gap: 8 * scale }}>
				{children}
			</div>
		</div>
	);
	const header = (sender: string, ts: number) => (
		<div
			className="clawbot-message-header"
			style={{ gap: 10 * scale, marginBottom: 6 * scale }}
		>
			<span className="clawbot-sender" style={{ fontSize: 16 * scale }}>
				{sender}
			</span>
			<span className="clawbot-time" style={{ fontSize: 13 * scale }}>
				{formatChatTime(ts, locale)}
			</span>
		</div>
	);
	return (
		<div
			ref={area}
			className="clawbot-messages"
			style={{ padding: 20 * scale, gap: 16 * scale }}
			onScroll={onScroll}
			data-quake-sub-touch="quakeBotIconViewMessages"
			data-support-quake-move="true"
		>
			{state.groups.map((group, groupIndex) => {
				const visible = group.messages.filter(
					(message) => message._tag !== "answer" || message.view.text !== "",
				);
				if (visible.length === 0) return null;
				return row(
					group.id,
					avatarFor(group),
					groupIndex,
					visible.map((message, index) => (
						<div key={message.id} className="clawbot-block">
							{header(senderLabel(locale, group, message), message.ts)}
							{message._tag === "tool" ? (
								<div {...bubble(index, visible.length, "tool")}>
									<ToolCard tool={message} scale={scale} locale={locale} />
								</div>
							) : (
								<div
									{...bubble(
										index,
										visible.length,
										group.kind === "system"
											? "hint"
											: message._tag === "text" && message.isVoice
												? "voice"
												: undefined,
									)}
								>
									<RichText
										value={parseRichText(
											message._tag === "answer"
												? message.view.text
												: chatText(locale, message.text),
										)}
										scale={scale}
										onOpen={onOpen}
									/>
								</div>
							)}
						</div>
					)),
				);
			})}
			{live
				? row(
						"live-voice",
						{ emoji: "🎤", tone: "voice" },
						state.groups.length,
						<div className="clawbot-block">
							{header(
								`${stripText(locale, "quakeBotIconView.voiceInput")}${Option.match(
									live.agentName,
									{
										onNone: () => "",
										onSome: (name) => (name === "" ? "" : ` · ${name}`),
									},
								)}`,
								live.ts,
							)}
							<div
								className="clawbot-bubble"
								style={{
									padding: `${12 * scale}px ${16 * scale}px`,
									borderRadius: `${8 * scale}px ${20 * scale}px ${20 * scale}px ${20 * scale}px`,
									fontSize: 22 * scale,
								}}
							>
								<RichText
									value={parseRichText(live.transcript.text)}
									scale={scale}
									onOpen={onOpen}
								/>
							</div>
						</div>,
					)
				: null}
		</div>
	);
}

/**
 * ClawBotView (`quakeBot`, 4×2; QBV, strip-voice-ui "ClawBotView"): glass
 * card, header with the connection pill, and the conversation.
 */
export function ClawBotTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const { view, locale, surface, wheelOpen } = context.voice;
	const { width, height } = tile.box;
	const scale = clawBotScale(width, height);
	const state = view.conversation;
	const open = useMemo(
		() => (url: string) => {
			void context.voice.request({ _tag: "OpenLink", url });
		},
		[context.voice],
	);
	return (
		<div
			className="clawbot"
			data-wheel={wheelOpen || undefined}
			style={{ width, height, borderRadius: tile.tileRadius || 24 }}
		>
			<div
				className="clawbot-header"
				style={{ height: 64 * scale, padding: `0 ${24 * scale}px` }}
			>
				<div
					className="clawbot-title"
					style={{ gap: 10 * scale, fontSize: 20 * scale }}
				>
					<div
						className="clawbot-title-icon"
						style={{
							width: 36 * scale,
							height: 36 * scale,
							borderRadius: 10 * scale,
							fontSize: 18 * scale,
						}}
					>
						💬
					</div>
					<span>
						{stripText(locale, "quakeBotIconView.interactionHistory")}
					</span>
				</div>
				<button
					type="button"
					className="clawbot-pill"
					data-quake-sub-touch="quakeBotHeaderTouchIcon"
					onClick={() => {
						void context.voice.request({
							_tag: "ReadAloud",
							keyCode: tile.keyCode,
						});
					}}
					style={{
						minHeight: 32 * scale,
						padding: `${6 * scale}px ${16 * scale}px`,
						borderRadius: 20 * scale,
						gap: 10 * scale,
					}}
				>
					<span className="clawbot-pill-shimmer" aria-hidden="true" />
					<span
						className="clawbot-pill-fx"
						aria-hidden="true"
						style={{ height: 26 * scale }}
					>
						<span className="clawbot-dot-idle" />
						<span className="clawbot-dot-idle" />
						<span className="clawbot-dot-idle" />
					</span>
					<span
						className="clawbot-badge"
						style={{ gap: 8 * scale, fontSize: 14 * scale }}
					>
						<span
							className="clawbot-badge-dot"
							data-state={state.connection}
							style={{ width: 8 * scale, height: 8 * scale }}
						/>
						<span>
							{stripText(locale, CONNECTION_LABELS[state.connection])}
						</span>
					</span>
				</button>
			</div>
			{surface === "panel" ? (
				<Messages state={state} locale={locale} scale={scale} onOpen={open} />
			) : null}
		</div>
	);
}

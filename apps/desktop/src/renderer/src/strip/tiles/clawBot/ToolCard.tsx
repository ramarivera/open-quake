import { Option } from "effect";
import { useRef, useState } from "react";
import { type StripLocale, stripText } from "../../overlays/voice/strings";
import { useSubTouchTap } from "../../overlays/voice/sub-touch";
import type { ChatMessage } from "./conversation";
import { toolPreview } from "./tool-parse";

/** QuakeToolCommandCard (AI-178, AI-179): an inert card; exec/search kinds expand. */
export function ToolCard({
	tool,
	scale,
	locale,
}: {
	tool: Extract<ChatMessage, { _tag: "tool" }>;
	scale: number;
	locale: StripLocale;
}): React.JSX.Element {
	const [open, setOpen] = useState(false);
	const preview = toolPreview(tool.name, tool.args);
	const ref = useRef<HTMLButtonElement>(null);
	const toggle = (): void => {
		if (Option.isSome(preview)) setOpen((value) => !value);
	};
	useSubTouchTap(ref, toggle, scale);
	const phase =
		tool.phase === "start"
			? "quakeBotIconView.toolRunning"
			: tool.phase === "result"
				? "quakeBotIconView.toolDone"
				: "quakeBotIconView.toolFailed";
	return (
		<div
			className="clawbot-tool"
			data-phase={tool.phase}
			style={{
				marginTop: 6 * scale,
				padding: `${12 * scale}px ${14 * scale}px`,
				borderRadius: 12 * scale,
			}}
		>
			<button
				ref={ref}
				type="button"
				className="clawbot-tool-row"
				data-quake-sub-touch={`tool-${tool.toolCallId}`}
				disabled={Option.isNone(preview)}
				aria-expanded={Option.isSome(preview) ? open : undefined}
				onClick={toggle}
				style={{ minHeight: 44 * scale, gap: 10 * scale }}
			>
				<span
					className="clawbot-tool-dot"
					style={{ width: 10 * scale, height: 10 * scale }}
				/>
				<span className="clawbot-tool-label" style={{ fontSize: 19.5 * scale }}>
					{stripText(locale, "quakeBotIconView.toolCardLabel")}
				</span>
				<span className="clawbot-tool-name" style={{ fontSize: 16.5 * scale }}>
					{tool.name}
				</span>
				<span className="clawbot-tool-phase" style={{ fontSize: 16.5 * scale }}>
					{stripText(locale, phase)}
				</span>
			</button>
			{open && Option.isSome(preview) ? (
				<pre
					className="clawbot-tool-preview"
					style={{
						maxHeight: 160 * scale,
						fontSize: 16.5 * scale,
						borderRadius: 8 * scale,
						padding: 10 * scale,
					}}
				>
					{preview.value}
				</pre>
			) : null}
		</div>
	);
}

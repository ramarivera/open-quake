import { useRef } from "react";
import { useSubTouchTap } from "../../overlays/voice/sub-touch";
import type { Block, Inline, RichText as RichTextData } from "./rich-text";

/** A link chip (QuakeLinkChipCard.vue, AI-176); activation goes through main. */
function LinkChip({
	url,
	label,
	scale,
	onOpen,
}: {
	url: string;
	label: string;
	scale: number;
	onOpen: (url: string) => void;
}): React.JSX.Element {
	const ref = useRef<HTMLButtonElement>(null);
	useSubTouchTap(ref, () => onOpen(url), scale);
	return (
		<button
			ref={ref}
			type="button"
			className="clawbot-chip"
			data-quake-sub-touch={`link-${url}`}
			title={url}
			onClick={() => onOpen(url)}
			style={{
				minHeight: Math.max(66 * scale, 44),
				padding: `${10 * scale}px ${14 * scale}px`,
				borderRadius: 10 * scale,
				gap: 8 * scale,
			}}
		>
			<span className="clawbot-chip-icon" style={{ fontSize: 21 * scale }}>
				🔗
			</span>
			<span className="clawbot-chip-label" style={{ fontSize: 18 * scale }}>
				{label}
			</span>
		</button>
	);
}

interface Render {
	readonly scale: number;
	readonly onOpen: (url: string) => void;
}

function renderInline(
	inline: Inline,
	key: number,
	render: Render,
): React.JSX.Element {
	switch (inline._tag) {
		case "text":
			return <span key={key}>{inline.text}</span>;
		case "bold":
			return (
				<strong key={key} className="clawbot-bold">
					{inline.children.map((child, index) =>
						renderInline(child, index, render),
					)}
				</strong>
			);
		case "code":
			return (
				<code key={key} className="clawbot-inline-code">
					{inline.text}
				</code>
			);
		case "link":
			return (
				<LinkChip
					key={key}
					url={inline.url}
					label={inline.label}
					scale={render.scale}
					onOpen={render.onOpen}
				/>
			);
	}
}
const inlines = (items: readonly Inline[], render: Render) =>
	items.map((inline, index) => renderInline(inline, index, render));

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function renderBlock(
	block: Block,
	key: number,
	render: Render,
): React.JSX.Element {
	switch (block._tag) {
		case "heading": {
			const Heading = HEADINGS[Math.min(block.level, 6) - 1] ?? "h6";
			return (
				<Heading
					key={key}
					className="clawbot-heading"
					data-level={Math.min(block.level, 3)}
				>
					{inlines(block.inlines, render)}
				</Heading>
			);
		}
		case "paragraph":
			return (
				<p key={key} className="clawbot-paragraph">
					{inlines(block.inlines, render)}
				</p>
			);
		case "list": {
			const items = block.items.map((item, index) => (
				// Items have no identity beyond their position in a finished message.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above.
				<li key={index}>{inlines(item, render)}</li>
			));
			return block.ordered ? (
				<ol key={key} className="clawbot-list">
					{items}
				</ol>
			) : (
				<ul key={key} className="clawbot-list">
					{items}
				</ul>
			);
		}
		case "quote":
			return (
				<blockquote key={key} className="clawbot-quote">
					{inlines(block.inlines, render)}
				</blockquote>
			);
		case "code":
			return (
				<pre key={key} className="clawbot-code">
					{block.text}
				</pre>
			);
	}
}

/**
 * QuakeChatRichText (AI-172–AI-174): markdown blocks or plain pre-wrap text,
 * built from parsed data as React elements, so every string is escaped.
 */
export function RichText({
	value,
	scale,
	onOpen,
}: {
	value: RichTextData;
	scale: number;
	onOpen: (url: string) => void;
}): React.JSX.Element {
	const render = { scale, onOpen };
	return value._tag === "plain" ? (
		<div className="clawbot-plain">{inlines(value.inlines, render)}</div>
	) : (
		<div className="clawbot-markdown">
			{value.blocks.map((block, index) => renderBlock(block, index, render))}
		</div>
	);
}

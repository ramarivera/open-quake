import type {
	Block,
	Inline,
	RichText,
} from "../../strip/tiles/clawBot/rich-text";

/**
 * Renders parsed generated text as React elements, so every string is
 * escaped: no raw HTML, scripts or remote images can reach the transcript.
 * Links open through the host instead of navigating this window.
 */
export function Prose({
	value,
	onOpen,
	linkHint,
}: {
	readonly value: RichText;
	readonly onOpen: (url: string) => void;
	readonly linkHint: string;
}) {
	const inline = (item: Inline, key: number): React.JSX.Element => {
		switch (item._tag) {
			case "text":
				return <span key={key}>{item.text}</span>;
			case "bold":
				return <strong key={key}>{item.children.map(inline)}</strong>;
			case "code":
				return <code key={key}>{item.text}</code>;
			case "link":
				return (
					<button
						key={key}
						type="button"
						className="cw-link"
						title={`${item.url} · ${linkHint}`}
						onClick={() => onOpen(item.url)}
					>
						{item.label}
					</button>
				);
		}
	};
	const block = (item: Block, key: number): React.JSX.Element => {
		switch (item._tag) {
			case "heading":
				return (
					<p
						key={key}
						className="cw-prose-heading"
						data-level={Math.min(item.level, 3)}
					>
						{item.inlines.map(inline)}
					</p>
				);
			case "paragraph":
				return <p key={key}>{item.inlines.map(inline)}</p>;
			case "list": {
				const items = item.items.map((entry, index) => (
					// Items have no identity beyond their position in the answer.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above.
					<li key={index}>{entry.map(inline)}</li>
				));
				return item.ordered ? (
					<ol key={key}>{items}</ol>
				) : (
					<ul key={key}>{items}</ul>
				);
			}
			case "quote":
				return <blockquote key={key}>{item.inlines.map(inline)}</blockquote>;
			case "code":
				return (
					<pre key={key}>
						<code>{item.text}</code>
					</pre>
				);
		}
	};
	return (
		<div className="cw-prose">
			{value._tag === "plain" ? (
				<p className="cw-prose-plain">{value.inlines.map(inline)}</p>
			) : (
				value.blocks.map(block)
			)}
		</div>
	);
}

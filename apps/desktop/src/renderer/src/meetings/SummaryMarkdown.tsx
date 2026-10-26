import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** React owns every element. Raw HTML stays text; provider images never fetch. */
export function SummaryMarkdown({ text }: { text: string }): React.JSX.Element {
	return (
		<div className="meeting-markdown">
			<Markdown
				remarkPlugins={[remarkGfm]}
				urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
				components={{
					a: ({ href, children }) =>
						href ? (
							<a href={href} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						) : (
							<span>{children}</span>
						),
					img: ({ alt }) => <span>{alt}</span>,
				}}
			>
				{text}
			</Markdown>
		</div>
	);
}

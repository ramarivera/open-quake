import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	formatTimer,
	type MeetingRecord,
	markRanges,
} from "../../../shared/meeting-bridge";

type Range = ReturnType<typeof markRanges>[number];
type Segment = MeetingRecord["transcript"][number];
function transcriptUnits(segment: Segment) {
	const fallback = () => ({
		words: [{ ...segment, before: "" }],
		tail: "",
		timed: false,
	});
	if (!segment.words?.length) return fallback();
	let offset = 0;
	const words = [];
	for (const word of segment.words) {
		const text = word.text.trim();
		const start = text ? segment.text.indexOf(text, offset) : -1;
		// Provider tokens aren't guaranteed to reproduce the saved paragraph.
		// Keep all punctuation and gaps, or fall back to the original paragraph.
		if (start < 0) return fallback();
		words.push({ ...word, text, before: segment.text.slice(offset, start) });
		offset = start + text.length;
	}
	return { words, tail: segment.text.slice(offset), timed: true };
}
export function tooltipBounds(
	rect: Pick<DOMRect, "left" | "top" | "bottom">,
	width: number,
	height: number,
) {
	const available = Math.max(0, width - 40);
	const tooltipWidth = Math.min(260, available);
	return {
		width: tooltipWidth,
		left: Math.max(20, Math.min(rect.left, width - tooltipWidth - 20)),
		top: Math.max(20, Math.min(rect.bottom + 8, height - 100)),
	};
}
function Bookmark({
	range,
	edge,
	selected,
	onToggle,
}: {
	range: Range;
	edge: "begin" | "end";
	selected: boolean;
	onToggle: () => void;
}): React.JSX.Element {
	const button = useRef<HTMLButtonElement>(null);
	const [position, setPosition] = useState<ReturnType<typeof tooltipBounds>>();
	const show = () => {
		if (button.current)
			setPosition(
				tooltipBounds(
					button.current.getBoundingClientRect(),
					window.innerWidth,
					window.innerHeight,
				),
			);
	};
	useEffect(() => {
		const hide = () => setPosition(undefined);
		window.addEventListener("resize", hide);
		window.addEventListener("scroll", hide, true);
		return () => {
			window.removeEventListener("resize", hide);
			window.removeEventListener("scroll", hide, true);
		};
	}, []);
	const tooltipId = `meeting-mark-${range.index}-${edge}`;
	return (
		<>
			<button
				ref={button}
				type="button"
				className="meeting-bookmark"
				aria-label={`Mark ${range.index} ${edge}`}
				aria-pressed={selected}
				aria-describedby={position ? tooltipId : undefined}
				onClick={onToggle}
				onFocus={show}
				onBlur={() => setPosition(undefined)}
				onMouseEnter={show}
				onMouseLeave={() => setPosition(undefined)}
			>
				<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true">
					<path d="M1 1h14v18l-7-5-7 5z" fill="currentColor" />
				</svg>
				<span>{range.index}</span>
			</button>
			{position
				? createPortal(
						<div
							id={tooltipId}
							role="tooltip"
							className="meeting-mark-tooltip"
							style={position}
						>
							<div>Start time : {range.startMs}ms</div>
							<div>
								End time : {range.endMs}ms{range.open ? " · Open mark" : ""}
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
export function MeetingTranscript({
	record,
	now,
}: {
	record: MeetingRecord;
	now: number;
}): React.JSX.Element {
	const [selected, setSelected] = useState<readonly number[]>([]);
	const ranges = markRanges(record, now);
	const segments = record.transcript.map((segment) => ({
		segment,
		...transcriptUnits(segment),
	}));
	const units = segments.flatMap(({ words }) => words);
	const boundaries = ranges.map((range) => {
		const overlaps = units.flatMap((unit, index) =>
			unit.endMs > range.startMs && unit.startMs < range.endMs ? [index] : [],
		);
		return { range, first: overlaps[0], last: overlaps.at(-1) };
	});
	let offset = 0;
	const toggle = (index: number) =>
		setSelected((current) =>
			current.includes(index)
				? current.filter((id) => id !== index)
				: [...current, index],
		);
	return (
		<>
			{segments.map(({ segment, words, tail, timed }) => {
				const start = offset;
				offset += words.length;
				const overlaps = ranges.some(
					(range) =>
						segment.endMs > range.startMs && segment.startMs < range.endMs,
				);
				return (
					<div
						key={segment.id}
						className="meeting-transcript-segment"
						data-marked={!timed && overlaps}
					>
						<p>
							<time>{formatTimer(segment.startMs)}</time>{" "}
							<strong>Speaker {segment.speaker}</strong>
						</p>
						<p className="meeting-transcript-text">
							{words.map((word, index) => {
								const unitIndex = start + index;
								const active = boundaries.filter(
									({ range }) =>
										word.endMs > range.startMs && word.startMs < range.endMs,
								);
								return (
									<Fragment key={`${unitIndex}-${word.startMs}`}>
										<span className="meeting-transcript-gap">
											{word.before}
										</span>
										{boundaries
											.filter((boundary) => boundary.first === unitIndex)
											.map(({ range }) => (
												<Fragment key={range.index}>
													<span className="meeting-mark-line">
														{formatTimer(range.startMs)} [ Mark {range.index}{" "}
														begin ]
													</span>
													<Bookmark
														range={range}
														edge="begin"
														selected={selected.includes(range.index)}
														onToggle={() => toggle(range.index)}
													/>
												</Fragment>
											))}
										<span
											className="meeting-transcript-word"
											data-marked={active.length > 0}
											data-selected={active.some(({ range }) =>
												selected.includes(range.index),
											)}
										>
											{word.text}
										</span>
										{boundaries
											.filter((boundary) => boundary.last === unitIndex)
											.map(({ range }) => (
												<Fragment key={range.index}>
													<Bookmark
														range={range}
														edge="end"
														selected={selected.includes(range.index)}
														onToggle={() => toggle(range.index)}
													/>
													<span className="meeting-mark-line">
														{formatTimer(range.endMs)} [ Mark {range.index} end
														]
													</span>
												</Fragment>
											))}
									</Fragment>
								);
							})}
							<span className="meeting-transcript-gap">{tail}</span>
						</p>
					</div>
				);
			})}
		</>
	);
}

import { Option } from "effect";
import { useEffect, useState } from "react";
import type {
	MeetingRecord,
	MeetingStageState,
} from "../../../../../shared/meeting-bridge";
import { MeetingGlyph } from "./MeetingGlyph";

// A remount may show the remaining success state, but must not replay its bursts.
const celebrated = new Map<string, number>();

export function MeetingAnimation({
	record,
	progress: latestProgress,
}: {
	record: MeetingRecord | undefined;
	progress?: MeetingStageState | undefined;
}): React.JSX.Element {
	const progress =
		record?.state === "recorded" &&
		latestProgress?.stage === 1 &&
		latestProgress.status === 2
			? undefined
			: latestProgress;
	const [celebrate, setCelebrate] = useState(false);
	const panel =
		new URLSearchParams(
			typeof window === "undefined" ? "" : window.location.search,
		).get("surface") === "panel";
	const completedAt =
		record && Option.isSome(record.provenance)
			? record.provenance.value.generatedAt
			: 0;
	const main = record && Option.isNone(record.parentId);
	useEffect(() => {
		const now = Date.now();
		for (const [id, at] of celebrated) {
			if (now - at >= 5000) celebrated.delete(id);
		}
		if (
			!panel ||
			!main ||
			record?.state !== "completed" ||
			!completedAt ||
			now - completedAt >= 5000 ||
			celebrated.get(record.id) === completedAt
		) {
			setCelebrate(false);
			return;
		}
		celebrated.set(record.id, completedAt);
		setCelebrate(true);
		const timer = setTimeout(
			() => setCelebrate(false),
			Math.max(0, 5000 - (Date.now() - completedAt)),
		);
		return () => clearTimeout(timer);
	}, [completedAt, panel, main, record?.id, record?.state]);
	const state = progress
		? progress.status === 0
			? record?.state === "cancelled"
				? "idle"
				: "failure"
			: progress.stage === 0
				? progress.status === 1
					? "recording"
					: "processing"
				: progress.stage === 5 && progress.status === 2
					? "success"
					: "processing"
		: record?.state === "recording"
			? "recording"
			: record?.state === "processing"
				? "processing"
				: record?.state === "failed" || record?.state === "interrupted"
					? "failure"
					: record?.state === "completed"
						? "success"
						: "idle";
	const label =
		progress && progress.status !== 0
			? progress.stage === 0
				? "Recording"
				: progress.stage === 1 ||
						(progress.stage === 2 && progress.status === 1)
					? "Recording ended, uploading"
					: progress.stage === 2
						? "Upload completed, ready to parse"
						: progress.stage === 3
							? "Parsing"
							: progress.stage === 5 && progress.status === 2
								? "Minutes generation completed"
								: "Parsing completed, generating minutes"
			: state === "recording"
				? "Recording"
				: state === "processing"
					? "Parsing completed, generating minutes"
					: state === "failure"
						? "Processing failed"
						: state === "success"
							? "Minutes generation completed"
							: "Main meeting is off";
	return (
		<div
			className="meeting-animation"
			data-animation={state}
			data-celebrate={celebrate}
		>
			{state === "recording" || state === "idle" ? (
				<div className="meeting-orbit">
					<MeetingGlyph kind="mic" />
					<i />
					<i />
					<i />
				</div>
			) : state === "success" ? (
				<svg
					className="meeting-success"
					viewBox="0 0 100 100"
					aria-hidden="true"
				>
					<circle cx="50" cy="50" r="40" />
					<path d="m28 50 15 15 30-32" />
				</svg>
			) : (
				<svg className="meeting-gears" viewBox="0 0 180 120" aria-hidden="true">
					<g className="meeting-gear">
						<circle cx="62" cy="60" r="35" />
						{Array.from({ length: 16 }, (_, i) => i * 22.5).map((angle) => (
							<path
								key={angle}
								transform={`rotate(${angle} 62 60)`}
								d="M55 14h14v14H55Z"
							/>
						))}
						<circle cx="62" cy="60" r="11" />
					</g>
					<g className="meeting-gear small">
						<circle cx="132" cy="75" r="24" />
						{Array.from({ length: 12 }, (_, i) => i * 30).map((angle) => (
							<path
								key={angle}
								transform={`rotate(${angle} 132 75)`}
								d="M127 42h10v12h-10Z"
							/>
						))}
						<circle cx="132" cy="75" r="7" />
					</g>
					{state === "failure" ? (
						<path
							className="meeting-crack"
							d="m63 15-9 23 18 13-19 20 16 14-7 20"
						/>
					) : null}
				</svg>
			)}
			<p>{label}</p>
			{celebrate ? (
				<svg
					className="meeting-fireworks"
					viewBox="0 0 900 320"
					aria-hidden="true"
				>
					{Array.from({ length: 35 }, (_, index) => ({
						x: 40 + ((index * 127) % 820),
						y: 20 + ((index * 73) % 260),
						delay: (index % 7) * 0.15,
					})).map((burst) => (
						<g
							key={burst.x}
							className="meeting-firework"
							style={{
								animationDelay: `${burst.delay}s`,
								transformOrigin: `${burst.x}px ${burst.y}px`,
							}}
						>
							{Array.from({ length: 8 }, (_, ray) => ray * 45).map((angle) => (
								<path
									key={angle}
									transform={`translate(${burst.x} ${burst.y}) rotate(${angle})`}
									d="M0 8v14"
								/>
							))}
						</g>
					))}
				</svg>
			) : null}
		</div>
	);
}

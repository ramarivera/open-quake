import { Option } from "effect";
import { useEffect, useRef, useState } from "react";
import { timeline, transcriptText } from "../../../../../shared/meeting-bridge";
import {
	meetingRequest,
	useMeetingNow,
	useMeetings,
} from "../../../meetings/useMeetings";
import type { StripTileProps } from "../../tileRegistry";
import { MeetingAnimation } from "./MeetingAnimation";
import { MeetingGlyph } from "./MeetingGlyph";
import { TouchButton } from "./TouchButton";
import "./meeting.css";

export function MeetingDisplay({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const { snapshot, error } = useMeetings();
	const now = useMeetingNow();
	const tab = snapshot?.tab ?? "main";
	const [expanded, setExpanded] = useState(false),
		[dock, setDock] = useState(false),
		[transcript, setTranscript] = useState(false);
	const [fonts, setFonts] = useState({ main: 0, temp: 0, live: 0 });
	const [feedback, setFeedback] = useState("");
	const [cleared, setCleared] = useState({ main: "", temp: "" });
	const body = useRef<HTMLDivElement>(null);
	const swipe = useRef<number | undefined>(undefined);
	const main = snapshot?.records.find((r) => Option.isNone(r.parentId));
	const temp = snapshot?.records.find((r) => Option.isSome(r.parentId));
	const record = tab === "main" ? main : temp;
	const progress = record
		? (context.voice.view.meetingStages.get(record.id) ??
			(context.voice.view.resetMeetings.has(record.id)
				? undefined
				: snapshot?.progress?.[record.id]))
		: undefined;
	const text =
		tab === "live"
			? (snapshot?.translations.map((p) => p.text).join("\n") ?? "")
			: record && cleared[tab] !== record.id
				? transcript
					? transcriptText(record.transcript)
					: record.minutes
				: "";
	const translatedAt = snapshot?.translations.at(-1)?.at;
	const slots = timeline(snapshot?.translations ?? []);
	const speed =
		translatedAt && now - translatedAt < 5000
			? `Update speed : ${((translatedAt - (snapshot?.translations.at(-2)?.at ?? translatedAt)) / 1000).toFixed(2)} S`
			: "Update speed : - -";
	useEffect(() => {
		if (tab === "live" && snapshot?.translations.length)
			body.current?.scrollTo({ top: body.current.scrollHeight });
	}, [tab, snapshot?.translations]);
	useEffect(() => {
		const target = body.current;
		if (!target) return;
		let previousY = 0,
			startX = 0;
		const start = (event: Event): void => {
			if (!(event instanceof CustomEvent)) return;
			const detail: unknown = event.detail;
			if (
				typeof detail !== "object" ||
				detail === null ||
				!("y" in detail) ||
				typeof detail.y !== "number" ||
				!("x" in detail) ||
				typeof detail.x !== "number" ||
				!("phase" in detail)
			)
				return;
			if (detail.phase === "start") {
				previousY = detail.y;
				startX = detail.x;
			} else {
				target.scrollTop += previousY - detail.y;
				previousY = detail.y;
			}
		};
		const end = (event: Event): void => {
			if (!(event instanceof CustomEvent)) return;
			const detail: unknown = event.detail;
			if (
				typeof detail === "object" &&
				detail !== null &&
				"x" in detail &&
				typeof detail.x === "number" &&
				tab === "temp" &&
				Math.abs(detail.x - startX) > 100
			)
				setTranscript(detail.x < startX);
		};
		target.addEventListener("quake-sub-touch-start", start);
		target.addEventListener("quake-sub-touch-end", end);
		return () => {
			target.removeEventListener("quake-sub-touch-start", start);
			target.removeEventListener("quake-sub-touch-end", end);
		};
	}, [tab]);

	const font = (delta: number) =>
		setFonts((values) => ({
			...values,
			[tab]: Math.max(-10, Math.min(20, values[tab] + delta)),
		}));
	const scroll = (delta: number, edge = false) =>
		body.current?.scrollTo({
			top: edge
				? delta < 0
					? 0
					: body.current.scrollHeight
				: body.current.scrollTop + delta,
			behavior: "auto",
		});
	const copy = async () => {
		try {
			if (text) {
				await navigator.clipboard.writeText(text);
				setFeedback("Copied");
			} else setFeedback("No content to copy");
		} catch {
			setFeedback("Copy failed, please copy manually");
		}
	};
	const scale = Math.min(tile.box.width / 1196, tile.box.height / 456);
	const stageHeight = tile.box.height / scale;
	return (
		<section
			className="meeting-display"
			aria-label="Meet AI"
			style={{ borderRadius: tile.tileRadius }}
			data-translating={snapshot?.translating}
			data-meeting-id={progress ? record?.id : undefined}
			data-meeting-stage={progress?.stage}
			data-meeting-status={progress?.status}
		>
			<div
				className="meeting-display-stage"
				style={{
					width: 1196,
					height: stageHeight,
					transform: `scale(${scale})`,
				}}
			>
				<header>
					<span>Meet AI</span>
					<nav aria-label="Meeting views">
						{(["main", "temp", "live"] as const).map((value) => (
							<TouchButton
								key={value}
								id={`meeting-tab-${value}`}
								label={
									value === "main"
										? "Main minutes"
										: value === "temp"
											? "Temporary record"
											: "Live translation"
								}
								pressed={tab === value}
								onClick={() => {
									void meetingRequest({ _tag: "tab", tab: value });
								}}
							>
								<MeetingGlyph
									kind={
										value === "main"
											? "mic"
											: value === "temp"
												? "record"
												: "translate"
									}
								/>
							</TouchButton>
						))}
					</nav>
					<TouchButton
						id="meeting-clear"
						label="Clear"
						onClick={() => {
							if (tab === "live") void meetingRequest({ _tag: "clear" });
							else if (record)
								setCleared((values) => ({ ...values, [tab]: record.id }));
						}}
					>
						×
					</TouchButton>
				</header>
				<div
					className="meeting-viewer-body"
					ref={body}
					data-quake-sub-touch="meeting-content"
					data-support-quake-move="true"
					style={{ fontSize: 24 + fonts[tab] }}
					onPointerDown={(event) => {
						swipe.current = event.clientX;
					}}
					onPointerUp={(event) => {
						if (
							swipe.current !== undefined &&
							Math.abs(event.clientX - swipe.current) > 100 * scale &&
							tab === "temp"
						)
							setTranscript(event.clientX < swipe.current);
						swipe.current = undefined;
					}}
				>
					{tab === "live" ? (
						snapshot?.translations.length ? (
							<div
								className="meeting-translations"
								lang={snapshot?.config.targetLanguage}
							>
								<aside>
									{slots.map((time) => (
										<time key={time}>
											{new Date(time).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
										</time>
									))}
								</aside>
								<div>
									{snapshot.translations.map((paragraph) => (
										<p key={paragraph.id} data-final={paragraph.final}>
											<strong>
												{paragraph.speaker
													? `Speaker ${paragraph.speaker}`
													: ""}
											</strong>
											<span>{paragraph.text}</span>
										</p>
									))}
								</div>
							</div>
						) : (
							<div className="meeting-viewer-empty">
								<MeetingGlyph kind="translate" />
								<p>
									{snapshot?.translating
										? "Update speed : - -"
										: "Live translation is off"}
								</p>
							</div>
						)
					) : tab === "temp" && record?.state === "recording" ? (
						<div className="meeting-viewer-empty">
							<p>Start Recording</p>
						</div>
					) : record &&
						((progress && record.state !== "completed") ||
							record.state === "processing" ||
							record.state === "failed" ||
							record.state === "interrupted" ||
							(record.state === "completed" &&
								Option.isSome(record.provenance) &&
								now - record.provenance.value.generatedAt < 5000 &&
								new URLSearchParams(window.location.search).get("surface") ===
									"panel")) ? (
						<MeetingAnimation record={record} progress={progress} />
					) : text ? (
						<>
							<div className="meeting-document-toggle">
								<TouchButton
									id="meeting-document-toggle"
									label={transcript ? "View Minutes" : "View Transcription"}
									onClick={() => setTranscript(!transcript)}
								>
									{transcript ? "Transcript" : "Summary"}
								</TouchButton>
								<span>
									{record?.state === "completed" && !transcript
										? "Generated minutes"
										: ""}
								</span>
							</div>
							<pre className="meeting-safe-text">{text}</pre>
						</>
					) : (
						<MeetingAnimation record={record} progress={progress} />
					)}
				</div>
				<div
					className="meeting-toolbar"
					data-expanded={expanded}
					data-left={dock}
				>
					<TouchButton
						id="meeting-toolbar-expand"
						label={expanded ? "Collapse toolbar" : "Expand toolbar"}
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? "−" : "+"}
					</TouchButton>
					{expanded ? (
						<>
							<TouchButton
								id="meeting-scroll-up"
								label="Scroll up"
								onClick={() => scroll(-300)}
								onLongPress={() => scroll(-300, true)}
							>
								↑
							</TouchButton>
							<TouchButton
								id="meeting-scroll-down"
								label="Scroll down"
								onClick={() => scroll(300)}
								onLongPress={() => scroll(300, true)}
							>
								↓
							</TouchButton>
							<TouchButton
								id="meeting-copy"
								label="Copy current content"
								onClick={() => {
									void copy();
								}}
							>
								⧉
							</TouchButton>
							<TouchButton
								id="meeting-font-up"
								label="Increase font size"
								disabled={fonts[tab] >= 20}
								onClick={() => font(2)}
							>
								A+
							</TouchButton>
							<TouchButton
								id="meeting-font-down"
								label="Decrease font size"
								disabled={fonts[tab] <= -10}
								onClick={() => font(-2)}
							>
								A−
							</TouchButton>
							<TouchButton
								id="meeting-dock"
								label="Move toolbar"
								onClick={() => setDock(!dock)}
							>
								↔
							</TouchButton>
						</>
					) : null}
				</div>
				<footer role="status">
					{error ||
						snapshot?.notice ||
						feedback ||
						(tab === "live" && snapshot?.translating
							? speed
							: snapshot?.mock
								? "Mock meeting session"
								: "")}
				</footer>
			</div>
		</section>
	);
}

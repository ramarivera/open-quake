import { Option } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	duration,
	formatTimer,
	type MeetingRecord,
	type MeetingStageState,
	summaryTemplates,
	transcriptText,
} from "../../../shared/meeting-bridge";
import { PageHeader } from "../ui/Form";
import {
	attendeeLabel,
	durationLabel,
	sortedMeetings,
	stageLabel,
	statusLabel,
} from "./history-presentation";
import { MeetingSettings } from "./MeetingSettings";
import { MeetingTranscript } from "./MeetingTranscript";
import { SummaryMarkdown } from "./SummaryMarkdown";
import { TaskInspector } from "./TaskInspector";
import { TitleEditor } from "./TitleEditor";
import {
	meetingRequest,
	useMeetingActivation,
	useMeetingNow,
	useMeetings,
} from "./useMeetings";
import "./meetings.css";

function MeetingDocument({
	record,
	now,
	onDelete,
	progress,
}: {
	record: MeetingRecord;
	now: number;
	onDelete: () => void;
	progress?: MeetingStageState | undefined;
}): React.JSX.Element {
	const [tab, setTab] = useState<"summary" | "transcript">(
		record.minutes ? "summary" : "transcript",
	);
	const [editing, setEditing] = useState(false),
		[message, setMessage] = useState("");
	const appliedId = Option.getOrElse(
		record.appliedTemplate,
		() => record.template,
	);
	const applied = summaryTemplates.find((t) => t.id === appliedId)?.name;
	const copy = async () => {
		try {
			const text =
				tab === "summary" ? record.minutes : transcriptText(record.transcript);
			if (!text) {
				setMessage("No content to copy");
				return;
			}
			await navigator.clipboard.writeText(text);
			setMessage(
				tab === "summary"
					? "Meeting minutes content copied to clipboard"
					: "Meeting transcription content copied to clipboard",
			);
		} catch {
			setMessage("Copy failed, please copy manually");
		}
	};
	return (
		<>
			<article className="meeting-document">
				<header>
					<h2>
						{record.title}
						<button
							type="button"
							aria-label="Edit meeting title"
							onClick={() => setEditing(true)}
						>
							✎
						</button>
					</h2>
					{editing ? (
						<TitleEditor
							record={record}
							onClose={() => setEditing(false)}
							onSaved={() => setMessage("Meeting title updated successfully")}
						/>
					) : null}
					<p className="meeting-meta">
						{new Date(record.startedAt).toLocaleString()} ·{" "}
						{formatTimer(duration(record, now))} · {attendeeLabel(record)}
					</p>
					<div className="meeting-document-actions">
						<button type="button" onClick={onDelete}>
							Delete
						</button>
						<button
							type="button"
							disabled={
								tab === "summary" ? !record.minutes : !record.transcript.length
							}
							onClick={() => {
								void meetingRequest({
									_tag: "export",
									id: record.id,
									artifact: tab,
								}).then((ok) =>
									setMessage(
										ok ? "Export dialog closed" : "Meeting export failed",
									),
								);
							}}
						>
							Export
						</button>
						{record.state === "recording" ? (
							<button
								type="button"
								onClick={() => {
									void meetingRequest({ _tag: "cancel", id: record.id });
								}}
							>
								Cancel recording
							</button>
						) : null}
					</div>
				</header>
				<div
					className="meeting-document-tabs"
					role="tablist"
					aria-label="Meeting content view"
				>
					<button
						type="button"
						role="tab"
						aria-selected={tab === "summary"}
						onClick={() => setTab("summary")}
					>
						Summary
					</button>
					<button
						type="button"
						role="tab"
						disabled={!record.transcript.length}
						aria-selected={tab === "transcript"}
						onClick={() => setTab("transcript")}
					>
						Transcript
					</button>
					<button
						type="button"
						className="meeting-copy"
						onClick={() => {
							void copy();
						}}
					>
						Copy
					</button>
				</div>
				{record.state === "processing" || record.state === "recording" ? (
					<p className="meeting-processing" role="status">
						{record.state === "recording"
							? "Start Recording"
							: `Processing, please wait... · ${stageLabel(record, progress)}`}
						<small>
							Tasks run independently. See current status on the right.
						</small>
					</p>
				) : record.state === "failed" || record.state === "interrupted" ? (
					<div className="meeting-processing" data-failed="true">
						<strong>Processing failed</strong>
						<small>
							Retry the failed task independently without affecting completed
							audio or transcript tasks.
						</small>
						<button
							type="button"
							className="button"
							onClick={() => {
								void meetingRequest({ _tag: "retry", id: record.id });
							}}
						>
							Retry
						</button>
					</div>
				) : null}
				<div
					className="meeting-document-body"
					role="tabpanel"
					aria-label={tab === "summary" ? "Meeting summary body" : "Transcript"}
				>
					{tab === "summary" ? (
						record.minutes ? (
							<>
								<p className="meeting-generated">
									Generated minutes · Current template: {applied}
								</p>
								<SummaryMarkdown text={record.minutes} />
							</>
						) : (
							<div className="meeting-empty">
								<h3>No meeting minutes content</h3>
								<p>Check task health or regenerate the summary.</p>
							</div>
						)
					) : record.transcript.length ? (
						<MeetingTranscript record={record} now={now} />
					) : (
						<div className="meeting-empty">No meeting minutes content</div>
					)}
				</div>
				<p role="status">{message}</p>
			</article>
			<TaskInspector record={record} onTab={setTab} />
		</>
	);
}
export function MeetingHistory({
	activation = 0,
}: {
	activation?: number;
}): React.JSX.Element {
	useMeetingActivation(activation);
	const { snapshot, error } = useMeetings();
	const now = useMeetingNow();
	const [filter, setFilter] = useState(""),
		[mode, setMode] = useState("records"),
		[selected, setSelected] = useState<string>(),
		[deleting, setDeleting] = useState<MeetingRecord>(),
		[refreshing, setRefreshing] = useState(false),
		[deletingBusy, setDeletingBusy] = useState(false);
	const deletingRef = useRef(false);
	const refreshRef = useRef(false);
	const refresh = async () => {
		if (refreshRef.current) return;
		refreshRef.current = true;
		setRefreshing(true);
		await Promise.all([
			meetingRequest({ _tag: "read" }),
			new Promise<void>((resolve) => setTimeout(resolve, 1000)),
		]);
		refreshRef.current = false;
		setRefreshing(false);
	};
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (!deleting) return;
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, [deleting]);
	const records = sortedMeetings(snapshot?.records ?? []).filter(
		(r) =>
			(mode !== "progress" ||
				r.state === "recording" ||
				r.state === "processing") &&
			`${r.title} ${new Date(r.startedAt).toLocaleString()}`
				.toLowerCase()
				.includes(filter.trim().toLowerCase()),
	);
	const record = records.find((r) => r.id === selected) ?? records[0];
	useEffect(() => {
		if (selected === undefined && record) setSelected(record.id);
	}, [record, selected]);
	return (
		<section className="meetings-page" data-revision={snapshot?.revision}>
			<PageHeader
				title="Meeting"
				description="View and manage your meeting minutes records"
			>
				<button
					type="button"
					className="button button-primary"
					onClick={() => {
						void meetingRequest({ _tag: "action", action: "meetingMinutes" });
					}}
				>
					{snapshot?.records.some(
						(r) => Option.isNone(r.parentId) && r.state === "recording",
					)
						? "Stop Recording"
						: "Start Recording"}
				</button>
			</PageHeader>
			<MeetingSettings
				key={JSON.stringify(snapshot?.config)}
				initial={snapshot?.config}
				mock={snapshot?.mock ?? false}
			/>
			<p className="meeting-notice" role="status">
				{error ||
					snapshot?.notice ||
					(snapshot?.mock
						? "Mock mode. No microphone, system audio or paid provider is used."
						: "")}
			</p>
			<div className="meeting-workspace">
				<nav
					className="meeting-list"
					aria-label="AI meeting navigation and records"
				>
					<div className="meeting-list-tabs">
						<button
							type="button"
							aria-pressed={mode === "progress"}
							onClick={() => setMode("progress")}
						>
							In progress
						</button>
						<button
							type="button"
							aria-pressed={mode === "records"}
							onClick={() => setMode("records")}
						>
							Meeting records
						</button>
					</div>
					<div className="meeting-search">
						<input
							aria-label="Search meetings"
							placeholder="Search meetings"
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
						/>
						<button
							type="button"
							aria-label="Refresh"
							aria-busy={refreshing}
							disabled={refreshing}
							onClick={() => {
								void refresh();
							}}
						>
							↻
						</button>
					</div>
					<p className="meeting-list-heading">
						{mode === "progress" ? "Active meetings" : "Recent meetings"}
					</p>
					{refreshing ? <p role="status">Refreshing meetings...</p> : null}
					{!records.length ? (
						<p className="meeting-empty">
							{filter ? "No matching meetings" : "No meeting minutes records"}
						</p>
					) : (
						records.map((r) => (
							<button
								type="button"
								key={r.id}
								className="meeting-record"
								data-record-id={r.id}
								aria-current={record?.id === r.id}
								onClick={() => setSelected(r.id)}
							>
								<span className="meeting-record-title">{r.title}</span>
								<time>{new Date(r.startedAt).toLocaleDateString()}</time>
								<span>
									{durationLabel(r, now)} ·{" "}
									{Option.isSome(r.parentId)
										? "Temporary Record"
										: "Main Meeting"}
								</span>
								<span data-state={r.state}>
									<i className="meeting-state-dot" />
									{r.state === "completed"
										? "Success"
										: `${statusLabel(r)} · ${stageLabel(r, snapshot?.progress?.[r.id])}`}
								</span>
							</button>
						))
					)}
				</nav>
				{record ? (
					<MeetingDocument
						key={record.id}
						record={record}
						progress={snapshot?.progress?.[record.id]}
						now={now}
						onDelete={() => setDeleting(record)}
					/>
				) : (
					<article className="meeting-empty">
						<h2>Select Meeting Minutes</h2>
						<p>
							Select a meeting minutes from the left list to view detailed
							content
						</p>
					</article>
				)}
			</div>
			{deleting ? (
				<dialog
					ref={dialog}
					onCancel={(event) => {
						if (deletingRef.current) event.preventDefault();
						else setDeleting(undefined);
					}}
					aria-labelledby="meeting-delete-title"
					className="meeting-dialog"
				>
					<h2 id="meeting-delete-title">Confirm deletion of meeting record</h2>
					<p>
						The meeting record and all its related files will be deleted and
						cannot be recovered. Continue?
					</p>
					<p>{deleting.title}</p>
					<button
						type="button"
						className="button"
						disabled={deletingBusy}
						onClick={() => setDeleting(undefined)}
					>
						Cancel
					</button>
					<button
						type="button"
						className="button"
						disabled={deletingBusy}
						onClick={() => {
							if (deletingRef.current) return;
							deletingRef.current = true;
							setDeletingBusy(true);
							const deletingId = deleting.id;
							const index = records.findIndex((item) => item.id === deletingId);
							const neighbours = [
								...records.slice(index + 1),
								...records.slice(0, index).reverse(),
							].filter((item) => !Option.contains(item.parentId, deletingId));
							void meetingRequest({
								_tag: "delete",
								id: deleting.id,
								confirmed: true,
							}).then((ok) => {
								deletingRef.current = false;
								setDeletingBusy(false);
								if (ok) {
									setDeleting(undefined);
									setSelected(neighbours[0]?.id);
								}
							});
						}}
					>
						Confirm Delete
					</button>
				</dialog>
			) : null}
		</section>
	);
}

import { Option } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	duration,
	formatTimer,
	type MeetingRecord,
	marked,
	summaryTemplates,
	type TaskState,
	transcriptText,
} from "../../../shared/meeting-bridge";
import { PageHeader } from "../ui/Form";
import { MeetingSettings } from "./MeetingSettings";
import { meetingRequest, useMeetingNow, useMeetings } from "./useMeetings";
import "./meetings.css";

const taskLabels: Record<TaskState, string> = {
	pending: "Pending",
	processing: "Processing",
	complete: "Complete",
	failed: "Needs attention",
	interrupted: "Needs attention",
};
function TaskInspector({
	record,
	onTab,
}: {
	record: MeetingRecord;
	onTab: (tab: "summary" | "transcript") => void;
}): React.JSX.Element {
	const tasks = [
		{ id: "audio", name: "Audio and upload", state: record.audio },
		{ id: "transcript", name: "Live transcript", state: record.transcription },
		{ id: "summary", name: "AI Summary", state: record.summary },
	] satisfies readonly { id: string; name: string; state: TaskState }[];
	return (
		<aside
			className="meeting-inspector"
			aria-label="Task health and template selection"
		>
			<h2>Task health</h2>
			{record.state === "recorded" ? (
				<button
					type="button"
					className="button"
					onClick={() => {
						void meetingRequest({ _tag: "retry", id: record.id });
					}}
				>
					Generate minutes
				</button>
			) : null}
			{tasks.map((task) => (
				<div className="meeting-task" key={task.id} data-state={task.state}>
					<span className="meeting-state-dot" />
					<div>
						<h3>{task.name}</h3>
						<p>{taskLabels[task.state]}</p>
						{task.state === "complete" ? (
							<button
								type="button"
								onClick={() => {
									if (task.id === "audio")
										void meetingRequest({ _tag: "reveal", id: record.id });
									else onTab(task.id === "summary" ? "summary" : "transcript");
								}}
							>
								{task.id === "audio"
									? "View audio file"
									: task.id === "summary"
										? "View summary"
										: "View transcript"}
							</button>
						) : task.state === "failed" || task.state === "interrupted" ? (
							<button
								type="button"
								onClick={() => {
									void meetingRequest({ _tag: "retry", id: record.id });
								}}
							>
								Retry task
							</button>
						) : null}
					</div>
				</div>
			))}
			<fieldset className="meeting-template-picker">
				<legend>Summary template</legend>
				{summaryTemplates.map((template) => (
					<label key={template.id}>
						<input
							type="radio"
							name={`template-${record.id}`}
							value={template.id}
							checked={record.template === template.id}
							onChange={() => {
								void meetingRequest({
									_tag: "template",
									id: record.id,
									template: template.id,
								});
							}}
						/>
						<span>
							<strong>{template.name}</strong>
							<small>{template.description}</small>
						</span>
					</label>
				))}
			</fieldset>
			<p className="meeting-hint">
				Changing the template does not alter the current summary until you
				regenerate.
			</p>
			<button
				type="button"
				className="button"
				disabled={
					!record.transcript.length ||
					record.state === "processing" ||
					record.state === "recording"
				}
				onClick={() => {
					void meetingRequest({
						_tag: "regenerate",
						id: record.id,
						template: record.template,
					});
				}}
			>
				Regenerate with template
			</button>
		</aside>
	);
}
function MeetingDocument({
	record,
	now,
	onDelete,
}: {
	record: MeetingRecord;
	now: number;
	onDelete: () => void;
}): React.JSX.Element {
	const [tab, setTab] = useState<"summary" | "transcript">(
		record.minutes ? "summary" : "transcript",
	);
	const [editing, setEditing] = useState(false),
		[title, setTitle] = useState(record.title),
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
					{editing ? (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								if (!title.trim()) return;
								void meetingRequest({
									_tag: "rename",
									id: record.id,
									title: title.trim(),
								}).then((ok) => {
									if (ok) setEditing(false);
								});
							}}
						>
							<label>
								Edit Meeting Title
								<input
									value={title}
									maxLength={100}
									required
									onChange={(event) => setTitle(event.target.value)}
								/>
							</label>
							<button className="button" type="submit">
								Save
							</button>
							<button type="button" onClick={() => setEditing(false)}>
								Cancel
							</button>
						</form>
					) : (
						<h2>
							{record.title}
							<button
								type="button"
								aria-label="Edit meeting title"
								onClick={() => {
									setTitle(record.title);
									setEditing(true);
								}}
							>
								✎
							</button>
						</h2>
					)}
					<p className="meeting-meta">
						{new Date(record.startedAt).toLocaleString()} ·{" "}
						{formatTimer(duration(record, now))} · Attendees not recorded
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
								});
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
							: "Processing, please wait..."}
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
								<pre>{record.minutes}</pre>
							</>
						) : (
							<div className="meeting-empty">
								<h3>No meeting minutes content</h3>
								<p>Check task health or regenerate the summary.</p>
							</div>
						)
					) : record.transcript.length ? (
						record.transcript.map((segment) => (
							<div
								key={segment.id}
								className="meeting-transcript-segment"
								data-marked={marked(record, segment)}
							>
								<p>
									<time>{formatTimer(segment.startMs)}</time>{" "}
									<strong>Speaker {segment.speaker}</strong>
								</p>
								<p>{segment.text}</p>
							</div>
						))
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
export function MeetingHistory(): React.JSX.Element {
	const { snapshot, error } = useMeetings();
	const now = useMeetingNow();
	const [filter, setFilter] = useState(""),
		[mode, setMode] = useState("records"),
		[selected, setSelected] = useState<string>(),
		[deleting, setDeleting] = useState<MeetingRecord>();
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		if (!deleting) return;
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, [deleting]);
	const records = (snapshot?.records ?? []).filter(
		(r) =>
			(mode !== "progress" ||
				r.state === "recording" ||
				r.state === "processing") &&
			`${r.title} ${new Date(r.startedAt).toLocaleString()}`
				.toLowerCase()
				.includes(filter.toLowerCase()),
	);
	const record = records.find((r) => r.id === selected) ?? records[0];
	return (
		<section className="meetings-page">
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
							onClick={() => {
								void meetingRequest({ _tag: "read" });
							}}
						>
							↻
						</button>
					</div>
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
								aria-current={record?.id === r.id}
								onClick={() => setSelected(r.id)}
							>
								<span className="meeting-record-title">{r.title}</span>
								<time>{new Date(r.startedAt).toLocaleDateString()}</time>
								<span>
									{Math.max(1, Math.round(duration(r, now) / 60000))} min ·{" "}
									{Option.isSome(r.parentId)
										? "Temporary Record"
										: "Main Meeting"}
								</span>
								<span data-state={r.state}>
									<i className="meeting-state-dot" />
									{r.state === "completed"
										? "Success"
										: r.state === "failed"
											? "Failed"
											: r.state}
								</span>
							</button>
						))
					)}
				</nav>
				{record ? (
					<MeetingDocument
						key={record.id}
						record={record}
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
					onCancel={() => setDeleting(undefined)}
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
						onClick={() => setDeleting(undefined)}
					>
						Cancel
					</button>
					<button
						type="button"
						className="button"
						onClick={() => {
							void meetingRequest({
								_tag: "delete",
								id: deleting.id,
								confirmed: true,
							}).then((ok) => {
								if (ok) setDeleting(undefined);
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

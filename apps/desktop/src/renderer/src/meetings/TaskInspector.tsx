import { Option } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	type MeetingRecord,
	summaryTemplates,
	type TaskState,
} from "../../../shared/meeting-bridge";
import { meetingRequest, useMeetings } from "./useMeetings";

const taskLabels: Record<TaskState, string> = {
	pending: "Pending",
	processing: "Processing",
	complete: "Complete",
	failed: "Needs attention",
	interrupted: "Needs attention",
};
interface Pending {
	readonly regenerate: boolean;
	readonly record: MeetingRecord;
	readonly acknowledged: boolean;
	readonly observed: boolean;
	readonly failureVersion: number;
}
export function TaskInspector({
	record,
	onTab,
}: {
	record: MeetingRecord;
	onTab: (tab: "summary" | "transcript") => void;
}): React.JSX.Element {
	const { failureVersion } = useMeetings();
	const [pending, setPending] = useState<Pending>();
	const [message, setMessage] = useState("");
	const [choosing, setChoosing] = useState(false);
	const busy = useRef(false);
	useEffect(() => {
		if (!pending) return;
		const failed = failureVersion > pending.failureVersion;
		if (!failed && record.state === "processing") {
			if (!pending.observed) setPending({ ...pending, observed: true });
			return;
		}
		if (!pending.acknowledged) return;
		const changed =
			(record.processingAttempt ?? 0) >
				(pending.record.processingAttempt ?? 0) ||
			record.minutes !== pending.record.minutes ||
			Option.getOrUndefined(record.provenance)?.generatedAt !==
				Option.getOrUndefined(pending.record.provenance)?.generatedAt ||
			!Option.getEquivalence((a, b) => a === b)(
				record.appliedTemplate,
				pending.record.appliedTemplate,
			);
		if (!failed && !pending.observed && !changed) return;
		if (failed || record.state === "failed" || record.state === "interrupted")
			setMessage(
				pending.regenerate
					? "Failed to regenerate summary"
					: "Meeting task failed",
			);
		else if (record.state === "completed")
			setMessage(
				pending.regenerate ? "Summary regenerated" : "Meeting task completed",
			);
		else return;
		busy.current = false;
		setPending(undefined);
	}, [record, pending, failureVersion]);
	const run = async (regenerate: boolean) => {
		if (busy.current) return;
		busy.current = true;
		const template = summaryTemplates.find(
			(item) => item.id === record.template,
		);
		setMessage(
			regenerate
				? `Regenerating with ${template?.name}.`
				: "Processing, please wait...",
		);
		setPending({
			regenerate,
			record,
			acknowledged: false,
			observed: false,
			failureVersion,
		});
		const ok = await meetingRequest(
			regenerate
				? { _tag: "regenerate", id: record.id, template: record.template }
				: { _tag: "retry", id: record.id },
		);
		if (!ok) {
			busy.current = false;
			setPending(undefined);
			setMessage(
				regenerate ? "Failed to regenerate summary" : "Meeting task failed",
			);
		} else
			setPending((current) =>
				current ? { ...current, acknowledged: true } : current,
			);
	};
	const tasks = [
		{ id: "audio", name: "Audio and upload", state: record.audio },
		{ id: "transcript", name: "Live transcript", state: record.transcription },
		{ id: "summary", name: "AI Summary", state: record.summary },
	] as const;
	const working =
		!!pending || record.state === "processing" || record.state === "recording";
	return (
		<aside
			className="meeting-inspector"
			aria-label="Task health and template selection"
			aria-busy={!!pending}
		>
			<h2>Task health</h2>
			{record.state === "recorded" ? (
				<button
					type="button"
					className="button"
					disabled={working}
					onClick={() => {
						void run(false);
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
										void meetingRequest({ _tag: "reveal", id: record.id }).then(
											(ok) =>
												setMessage(
													ok
														? "Audio is safely stored. Re-upload is only needed after a failure."
														: "Audio file not found",
												),
										);
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
								disabled={working}
								onClick={() => {
									void run(false);
								}}
							>
								Retry task
							</button>
						) : null}
					</div>
				</div>
			))}
			<fieldset
				className="meeting-template-picker"
				disabled={choosing || !!pending}
			>
				<legend>Summary template</legend>
				{summaryTemplates.map((template) => (
					<label key={template.id}>
						<input
							type="radio"
							name={`template-${record.id}`}
							value={template.id}
							checked={record.template === template.id}
							onChange={() => {
								setChoosing(true);
								void meetingRequest({
									_tag: "template",
									id: record.id,
									template: template.id,
								}).then((ok) => {
									setChoosing(false);
									if (!ok) setMessage("Summary template could not be saved");
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
			<p className="meeting-task-feedback" role="status">
				{message}
			</p>
			<button
				type="button"
				className="button"
				disabled={!record.transcript.length || working || choosing}
				onClick={() => {
					void run(true);
				}}
			>
				Regenerate with template
			</button>
		</aside>
	);
}

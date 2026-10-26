import { useEffect, useRef, useState } from "react";
import {
	type MeetingRecord,
	titleWeight,
} from "../../../shared/meeting-bridge";
import { meetingRequest } from "./useMeetings";

export function TitleEditor({
	record,
	onClose,
	onSaved,
}: {
	record: MeetingRecord;
	onClose: () => void;
	onSaved: () => void;
}): React.JSX.Element {
	const dialog = useRef<HTMLDialogElement>(null);
	const saving = useRef(false);
	const [title, setTitle] = useState(record.title);
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState("");
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	const save = async () => {
		if (saving.current) return;
		if (!title.trim()) {
			setMessage("Meeting title cannot be empty. Please re-enter.");
			return;
		}
		if (titleWeight(title.trim()) > 100) {
			setMessage("Meeting title must be at most 100 weighted characters");
			return;
		}
		saving.current = true;
		setPending(true);
		const ok = await meetingRequest({
			_tag: "rename",
			id: record.id,
			title: title.trim(),
		});
		saving.current = false;
		setPending(false);
		if (ok) {
			onSaved();
			onClose();
		} else setMessage("Meeting title update failed");
	};
	return (
		<dialog
			ref={dialog}
			className="meeting-dialog meeting-title-dialog"
			aria-labelledby="meeting-title-heading"
			onCancel={(event) => {
				if (saving.current) event.preventDefault();
				else onClose();
			}}
		>
			<h2 id="meeting-title-heading">Edit Meeting Title</h2>
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<label htmlFor="meeting-title-input">Please enter meeting title</label>
				<input
					id="meeting-title-input"
					value={title}
					maxLength={100}
					required
					disabled={pending}
					aria-describedby="meeting-title-weight"
					aria-invalid={titleWeight(title.trim()) > 100 || undefined}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<output id="meeting-title-weight" aria-live="polite">
					{titleWeight(title)}/100
				</output>
				<p role="status">{message}</p>
				<button className="button" type="submit" disabled={pending}>
					Save
				</button>
				<button
					className="button"
					type="button"
					disabled={pending}
					onClick={onClose}
				>
					Cancel
				</button>
			</form>
		</dialog>
	);
}

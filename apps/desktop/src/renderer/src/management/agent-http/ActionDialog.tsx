import { AgentDialog } from "../agents/Dialog";
import t from "./strings.json";

export function ActionDialog({
	title,
	body,
	confirm,
	busy,
	onClose,
	onConfirm,
}: {
	readonly title: string;
	readonly body: string;
	readonly confirm: string;
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => Promise<void>;
}) {
	return (
		<AgentDialog
			title={title}
			onClose={() => {
				if (!busy) onClose();
			}}
		>
			<p>{body}</p>
			<footer className="agent-http-actions">
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={onClose}
				>
					{t.cancel}
				</button>
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={() => void onConfirm()}
				>
					{busy ? t.busy : confirm}
				</button>
			</footer>
		</AgentDialog>
	);
}

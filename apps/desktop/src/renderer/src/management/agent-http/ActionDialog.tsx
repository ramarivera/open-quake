import { AgentDialog } from "../agents/Dialog";
import { runtimeStrings as t } from "./copy";

export function ActionDialog({
	title,
	body,
	confirm,
	busy,
	danger = false,
	onClose,
	onConfirm,
}: {
	readonly title: string;
	readonly body: string;
	readonly confirm: string;
	readonly busy: boolean;
	/** Destructive confirmations use the filled danger action. */
	readonly danger?: boolean;
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
			<footer className="cw-dialog-actions">
				<span className="cw-spacer" />
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
					data-primary
					data-variant={danger ? "danger" : undefined}
					disabled={busy}
					onClick={() => void onConfirm()}
				>
					{busy ? t.busy : confirm}
				</button>
			</footer>
		</AgentDialog>
	);
}

import { type ReactNode, useEffect, useId, useRef } from "react";
import strings from "./strings.json";
export function AgentDialog({
	title,
	children,
	onClose,
}: {
	readonly title: string;
	readonly children: ReactNode;
	readonly onClose: () => void;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const id = useId();
	useEffect(() => {
		ref.current?.showModal();
		return () => ref.current?.close();
	}, []);
	return (
		<dialog
			ref={ref}
			className="mc-dialog cw-dialog"
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<header className="cw-dialog-head">
				<h2 id={id}>{title}</h2>
				<button
					type="button"
					className="mc-button cw-dialog-close"
					data-variant="quiet"
					onClick={onClose}
					aria-label={strings.clawAgentManagement.close}
					title={strings.clawAgentManagement.close}
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						width="16"
						height="16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
					>
						<path d="M6 6l12 12M18 6 6 18" />
					</svg>
				</button>
			</header>
			<div className="cw-dialog-body">{children}</div>
		</dialog>
	);
}
export function ConfirmDialog({
	title,
	body,
	busy,
	onClose,
	onConfirm,
}: {
	readonly title: string;
	readonly body: string;
	readonly busy: boolean;
	readonly onClose: () => void;
	readonly onConfirm: () => Promise<void>;
}) {
	return (
		<AgentDialog title={title} onClose={onClose}>
			<p>{body}</p>
			<footer className="cw-dialog-actions">
				<span className="cw-spacer" />
				<button
					type="button"
					className="mc-button"
					onClick={onClose}
					disabled={busy}
				>
					{strings.clawAgentManagement.cancel}
				</button>
				<button
					type="button"
					className="mc-button"
					data-primary
					data-variant="danger"
					disabled={busy}
					onClick={() => void onConfirm()}
				>
					{busy
						? strings.clawAgentManagement.deleting
						: strings.clawAgentManagement.confirmDelete}
				</button>
			</footer>
		</AgentDialog>
	);
}
export const format = (
	value: string,
	params: Readonly<Record<string, string | number>>,
): string =>
	value.replace(/\{(\w+)\}/g, (_match, key: string) =>
		String(params[key] ?? ""),
	);

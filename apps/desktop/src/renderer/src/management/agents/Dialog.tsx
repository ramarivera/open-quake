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
			className="mc-dialog"
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<header className="mc-toolbar">
				<h2 id={id}>{title}</h2>
				<button
					type="button"
					className="mc-button"
					onClick={onClose}
					aria-label={strings.clawAgentManagement.close}
				>
					×
				</button>
			</header>
			{children}
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
			<footer className="mc-toolbar">
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

import { useEffect, useId, useRef, useState } from "react";
import Markdown from "react-markdown";
import privacyDe from "../../../../../../docs/privacy.de.md?raw";
import privacy from "../../../../../../docs/privacy.md?raw";
import noticeDe from "../../../../../../docs/software-notice.de.md?raw";
import notice from "../../../../../../docs/software-notice.md?raw";
import license from "../../../../../../LICENSE?raw";
import { useAppLocale } from "../i18n";

/** Project-owned reading, independent of service region and vendor legal terms. */
export function ProjectNotice(): React.JSX.Element {
	const de = useAppLocale().locale === "de";
	const [page, setPage] = useState<"license" | "privacy" | "notice" | null>(
		null,
	);
	const opener = useRef<HTMLButtonElement | null>(null);
	return (
		<div className="setup-legal">
			<p>
				{de
					? "open-quake ist ein unabhängiges Projekt für QUAKE."
					: "open-quake is an independent project for QUAKE."}
			</p>
			<p>
				{de
					? "Mit Los geht's stimmst du der MIT-Lizenz zu und bestätigst die lokalen Datenschutz- und Softwarehinweise."
					: 'By selecting "Get started", you agree to the MIT license and acknowledge the local privacy information and software notice.'}
			</p>
			<nav
				aria-label={de ? "Rechtliche Hinweise" : "Project legal documents"}
				className="button-row"
			>
				{(["license", "privacy", "notice"] as const).map((key) => (
					<button
						key={key}
						type="button"
						className="mc-button"
						onClick={(event) => {
							opener.current = event.currentTarget;
							setPage(key);
						}}
					>
						{key === "license"
							? de
								? "MIT-Lizenz"
								: "MIT license"
							: key === "privacy"
								? de
									? "Datenschutz"
									: "Privacy information"
								: de
									? "Softwarehinweise"
									: "Software notice"}
					</button>
				))}
			</nav>
			{page ? (
				<NoticeDialog
					page={page}
					de={de}
					onClose={() => {
						setPage(null);
						opener.current?.focus();
					}}
				/>
			) : null}
		</div>
	);
}
function NoticeDialog({
	page,
	de,
	onClose,
}: {
	page: "license" | "privacy" | "notice";
	de: boolean;
	onClose: () => void;
}): React.JSX.Element {
	const dialog = useRef<HTMLDialogElement>(null);
	const id = useId();
	useEffect(() => {
		const node = dialog.current;
		if (node && !node.open) node.showModal();
		return () => node?.close();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="guide-dialog setup-notice"
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<h2 id={id}>
				{page === "license"
					? de
						? "MIT-Lizenz"
						: "MIT license"
					: page === "privacy"
						? de
							? "Datenschutz"
							: "Privacy information"
						: de
							? "Softwarehinweise"
							: "Software notice"}
			</h2>
			<div className="setup-notice-content">
				{page === "license" ? (
					<pre lang="en">{license}</pre>
				) : (
					<Markdown skipHtml>
						{page === "privacy"
							? de
								? privacyDe
								: privacy
							: de
								? noticeDe
								: notice}
					</Markdown>
				)}
			</div>
			<button type="button" className="mc-button" onClick={onClose}>
				{de ? "Schließen" : "Close"}
			</button>
		</dialog>
	);
}

import { useEffect, useId, useRef, useState } from "react";
import { useAppLocale } from "../i18n";

/** Project-owned reading, independent of service region and vendor legal terms. */
export function ProjectNotice(): React.JSX.Element {
	const de = useAppLocale().locale === "de";
	const [page, setPage] = useState<"privacy" | "notice" | null>(null);
	const opener = useRef<HTMLButtonElement | null>(null);
	return (
		<div className="setup-legal">
			<p>
				{de
					? "open-quake ist ein unabhängiges Projekt für QUAKE."
					: "open-quake is an independent project for QUAKE."}
			</p>
			<nav
				aria-label={de ? "Rechtliche Hinweise" : "Project legal documents"}
				className="button-row"
			>
				{(["privacy", "notice"] as const).map((key) => (
					<button
						key={key}
						type="button"
						className="mc-button"
						onClick={(event) => {
							opener.current = event.currentTarget;
							setPage(key);
						}}
					>
						{key === "privacy"
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
	page: "privacy" | "notice";
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
				{page === "privacy"
					? de
						? "Datenschutz"
						: "Privacy information"
					: de
						? "Softwarehinweise"
						: "Software notice"}
			</h2>
			{page === "privacy" ? (
				<p>
					{de
						? "Diese lokale Einrichtung speichert deine Auswahl auf diesem Computer. Sie fragt keine IP-Geolokalisierung ab und meldet dich bei keinem Herstellerkonto an. Anbieter, Mikrofon, Bildschirm und Eingabeberechtigungen brauchen separate Aktionen. Wenn du später einen KI-Anbieter oder eine Integration aktivierst, können diese die ausgewählten Daten an deren konfigurierte Dienste senden."
						: "This local setup saves your choices on this computer. It doesn't look up your IP location or sign in to a vendor account. Providers, microphone, screen and input permissions require separate actions. If you later enable an AI provider or integration, it can send selected data to its configured services."}
				</p>
			) : (
				<p>
					{de
						? "open-quake ist kein offizielles DecoKee-Produkt. Lokale Einrichtung bestätigt keine physische Gerätefunktion. QUAKE-Kalibrierung ist nicht verfügbar. Herstellerbedingungen werden hier nicht übernommen."
						: "open-quake is an independent project, not an official DecoKee product. Completing local setup doesn't verify physical device behavior. QUAKE calibration is unavailable. Vendor terms aren't adopted by this setup."}
				</p>
			)}
			<button type="button" className="mc-button" onClick={onClose}>
				{de ? "Schließen" : "Close"}
			</button>
		</dialog>
	);
}

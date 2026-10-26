import { useEffect, useRef, useState } from "react";
import type { ProfileImportReport } from "../../../../../../packages/device/src/profiles/profile-import.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { KeyReply } from "../../../shared/key-library";
import { Group, Row } from "../ui/Form";

const messages = {
	"unknown-function": [
		"Unsupported function retained without execution",
		"Nicht unterstützte Funktion bleibt ohne Ausführung erhalten",
	],
	"missing-optional": [
		"Missing optional field uses its default",
		"Fehlendes optionales Feld verwendet den Standardwert",
	],
	"legacy-sentinel": [
		"Legacy empty value normalized; original retained",
		"Alter Leerwert normalisiert; Original bleibt erhalten",
	],
	"invalid-field": [
		"Invalid required field; import blocked",
		"Ungültiges Pflichtfeld; Import gesperrt",
	],
	"invalid-action": [
		"Invalid action retained without execution",
		"Ungültige Aktion bleibt ohne Ausführung erhalten",
	],
} as const;
export function KeyImport({
	locale,
	accept,
}: {
	readonly locale: ProfileLocale;
	readonly accept: (reply: KeyReply) => void;
}): React.JSX.Element {
	const [source, setSource] = useState("");
	const [report, setReport] = useState<ProfileImportReport>();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	const ticket = useRef(0);
	useEffect(
		() => () => {
			ticket.current++;
		},
		[],
	);
	const de = locale === "de";
	const request = async (type: "inspect-import" | "import-profile") => {
		const epoch = ++ticket.current;
		setBusy(true);
		try {
			const reply = await window.quakeKeyLibrary.request({ type, source });
			if (epoch !== ticket.current) return;
			if (reply._tag === "success") {
				if (reply.importReport) setReport(reply.importReport);
				if (type === "import-profile") {
					accept(reply);
					setReport(undefined);
					setStatus(de ? "Profil importiert." : "Profile imported.");
				}
			} else if (reply._tag === "rejected") setStatus(reply.reason);
		} finally {
			if (epoch === ticket.current) setBusy(false);
		}
	};
	return (
		<details className="keys-import">
			<summary>{de ? "Profil importieren" : "Import profile"}</summary>
			<Group title={de ? "JSON-Profil prüfen" : "Inspect JSON profile"}>
				<p>
					{de
						? "Ein Profil oder ein altes Tasten-Array auswählen oder einfügen. Nicht unterstützte Funktionen bleiben inaktiv."
						: "Choose or paste one profile or a legacy key array. Unsupported functions stay inactive."}
				</p>
				<fieldset disabled={busy} className="keys-save-boundary">
					<Row
						label={de ? "JSON-Datei" : "JSON file"}
						htmlFor="keys-import-file"
					>
						<input
							id="keys-import-file"
							type="file"
							accept=".json,application/json"
							onChange={async (event) => {
								const file = event.target.files?.[0];
								const epoch = ++ticket.current;
								setReport(undefined);
								setStatus("");
								if (!file) return;
								if (file.size > 8 * 1024 * 1024) {
									setStatus(de ? "Datei ist zu groß." : "File is too large.");
									return;
								}
								const text = await file.text();
								if (epoch === ticket.current) setSource(text);
							}}
						/>
					</Row>
					<Row label="JSON" htmlFor="keys-import-json">
						<textarea
							id="keys-import-json"
							value={source}
							onChange={(event) => {
								ticket.current++;
								setSource(event.target.value);
								setReport(undefined);
								setStatus("");
							}}
						/>
					</Row>
					<Row label="">
						<button
							type="button"
							id="keys-inspect-import"
							disabled={!source}
							onClick={() => void request("inspect-import")}
						>
							{de ? "Import prüfen" : "Inspect import"}
						</button>
						<button
							type="button"
							id="keys-confirm-import"
							disabled={!report?.profile}
							onClick={() => void request("import-profile")}
						>
							{de ? "Als neues Profil importieren" : "Import as new profile"}
						</button>
					</Row>
				</fieldset>
				{report && (
					<div className="keys-import-report" role="status">
						<p>
							{report.profile
								? de
									? "Bereit zum Import."
									: "Ready to import."
								: de
									? "Import gesperrt."
									: "Import blocked."}
						</p>
						<ul>
							{report.diagnostics.map((diagnostic) => (
								<li
									key={`${diagnostic.path}:${diagnostic.code}`}
									data-code={diagnostic.code}
								>
									<code>{diagnostic.path}</code>{" "}
									{messages[diagnostic.code][de ? 1 : 0]}
								</li>
							))}
						</ul>
					</div>
				)}
				{status && <p role="status">{status}</p>}
			</Group>
		</details>
	);
}

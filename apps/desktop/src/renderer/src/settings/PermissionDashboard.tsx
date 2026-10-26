import { useEffect, useRef, useState } from "react";
import type { PermissionKey } from "../../../shared/maintenance-contracts";
import { useAppLocale } from "../i18n";
import type { MaintenanceController } from "../maintenance/useMaintenance";

const names: Record<PermissionKey, string> = {
	accessibility: "Accessibility",
	inputMonitoring: "Input Monitoring",
	microphone: "Microphone",
	screenRecording: "Screen Recording",
	systemAudio: "System Audio Recording",
};
export function PermissionDashboard({
	controller: c,
}: {
	controller: Pick<MaintenanceController, "view" | "busy" | "request">;
}): React.JSX.Element {
	const de = useAppLocale().locale === "de";
	const requested = useRef(false);
	const [restart, setRestart] = useState(false);
	const [message, setMessage] = useState("");
	const accessibility = c.view?.permissions.find(
		(row) => row.key === "accessibility",
	)?.status;
	useEffect(() => {
		if (requested.current && accessibility === "granted") {
			requested.current = false;
			setRestart(true);
		}
	}, [accessibility]);
	// The shell lane owns this optional command; no alternate quit/relaunch path.
	const shell:
		| {
				readonly platform: string;
				readonly command?: (command: { action: "restart" }) => Promise<boolean>;
		  }
		| undefined = window.quakeManagement;
	return (
		<section
			className="setup-permission-dashboard"
			aria-label={de ? "Berechtigungen" : "Permissions"}
		>
			<h3>{de ? "Berechtigungen" : "Permissions"}</h3>
			<p className="setup-meta">
				{de
					? "Der Status wird alle 2 Sekunden und bei Rückkehr zum Fenster aktualisiert. Zugriff wird nur durch deine Aktion angefordert."
					: "Status refreshes every 2 seconds and when you return to this window. Access is requested only when you choose an action."}
			</p>
			{c.view?.permissions.map((permission) => (
				<div className="mc-row" key={permission.key}>
					<span>{names[permission.key]}</span>
					<span className="permission-status" data-status={permission.status}>
						{permission.status}
					</span>
					<button
						type="button"
						className="mc-button"
						disabled={c.busy || permission.status === "unsupported"}
						aria-label={`${permission.status === "granted" ? "Open Settings" : "Allow access"}: ${names[permission.key]}`}
						onClick={() => {
							if (
								permission.key === "accessibility" &&
								permission.status !== "granted"
							)
								requested.current = true;
							void c.request({ action: "permission", key: permission.key });
						}}
					>
						{permission.status === "granted"
							? de
								? "Einstellungen öffnen"
								: "Open Settings"
							: de
								? "Zugriff erlauben…"
								: "Allow access…"}
					</button>
				</div>
			))}
			{restart ? (
				<div role="status">
					<p>
						{de
							? "Neustart erforderlich. Starte open-quake nach der Freigabe der Bedienungshilfen neu."
							: "Restart required. Restart open-quake after granting Accessibility."}
					</p>
					<div className="button-row">
						<button
							type="button"
							className="mc-button"
							disabled={!shell?.command || c.busy}
							onClick={() => {
								void shell?.command?.({ action: "restart" }).then(
									(ok) => {
										if (!ok)
											setMessage(
												de
													? "Neustart nicht verfügbar. Öffne die App erneut."
													: "Restart unavailable. Reopen the app.",
											);
									},
									() =>
										setMessage(
											de ? "Neustart fehlgeschlagen." : "Restart failed.",
										),
								);
							}}
						>
							{de ? "Jetzt neu starten" : "Restart Now"}
						</button>
						<button
							type="button"
							className="mc-button"
							onClick={() => setRestart(false)}
						>
							{de ? "Später" : "Later"}
						</button>
					</div>
				</div>
			) : null}
			{message ? <p role="alert">{message}</p> : null}
		</section>
	);
}

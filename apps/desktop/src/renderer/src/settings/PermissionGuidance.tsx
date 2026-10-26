import { useEffect, useState } from "react";
import { useAppLocale } from "../i18n";
import { PERMISSION_GUIDE_SHOWN } from "./setup-launch";

/** A read-only first-run hint, not a permission request or grant. */
export function PermissionGuidance({
	ready,
	onOpen,
}: {
	ready: boolean;
	onOpen?: (() => void) | undefined;
}): React.JSX.Element | null {
	const de = useAppLocale().locale === "de";
	const [show, setShow] = useState(false);
	useEffect(() => {
		if (!ready || window.quakeLifecycle?.platform !== "darwin") return;
		let shown = false;
		try {
			shown = localStorage.getItem(PERMISSION_GUIDE_SHOWN) === "1";
		} catch {
			/* Keep guidance available when presentation storage is unavailable. */
		}
		if (shown) return;
		const timer = setTimeout(() => {
			try {
				localStorage.setItem(PERMISSION_GUIDE_SHOWN, "1");
			} catch {
				/* Never infer a permission grant from this flag. */
			}
			setShow(true);
		}, 1500);
		return () => clearTimeout(timer);
	}, [ready]);
	if (!show) return null;
	return (
		<aside
			className="setup-permissions"
			aria-label={de ? "Berechtigungen" : "Permissions"}
		>
			<h3>
				{de
					? "Berechtigungen bei Bedarf erlauben"
					: "Allow permissions when you need them"}
			</h3>
			<p>
				{de
					? "Bedienungshilfen und Eingabeüberwachung ermöglichen Tastenkürzel. Mikrofon, Bildschirm und Systemaudio brauchen separate Freigaben. Die Einrichtung fordert keinen Zugriff an."
					: "Accessibility and Input Monitoring support shortcuts. Microphone, Screen Recording and System Audio Recording each need separate access. Setup doesn't request access."}
			</p>
			<div className="button-row">
				{onOpen ? (
					<button type="button" className="mc-button" onClick={onOpen}>
						{de ? "Berechtigungen prüfen" : "Review permissions"}
					</button>
				) : null}
				<button
					type="button"
					className="mc-button"
					onClick={() => setShow(false)}
				>
					{de ? "Später" : "Later"}
				</button>
			</div>
		</aside>
	);
}

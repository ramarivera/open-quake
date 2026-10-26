import { useState } from "react";
import { createSetupLaunch } from "./setup-launch";
import type { SetupStore } from "./stores";

export function WizardDevelopmentControls({
	store,
	onOpen,
}: {
	store: SetupStore;
	onOpen: () => void;
}): React.JSX.Element | null {
	if (
		typeof window === "undefined" ||
		window.quakeSettings?.development !== true
	)
		return null;
	return <DevelopmentControls store={store} onOpen={onOpen} />;
}
function DevelopmentControls({
	store,
	onOpen,
}: {
	store: SetupStore;
	onOpen: () => void;
}): React.JSX.Element {
	const [owner] = useState(() =>
		createSetupLaunch(
			localStorage,
			window.quakeSettings?.development === true,
			window.quakeSettings?.wizardDebug === true,
		),
	);
	const [debug, setDebug] = useState(owner.debug);
	const [message, setMessage] = useState("");
	const [pending, setPending] = useState(false);
	return (
		<fieldset className="setup-dev">
			<legend>Development wizard controls</legend>
			<label>
				<input
					type="checkbox"
					checked={debug}
					onChange={(event) => {
						try {
							owner.setDebug(event.target.checked);
							setDebug(owner.debug());
							setMessage("");
						} catch {
							setMessage("Could not save wizard debug mode.");
						}
					}}
				/>{" "}
				Wizard debug mode
			</label>
			<p className="setup-meta">
				Debug opens setup on launch even after completion. Completion still
				saves local choices.
			</p>
			<div className="button-row">
				<button
					type="button"
					className="mc-button"
					disabled={pending}
					onClick={() => {
						setPending(true);
						void store.replay().then((ok) => {
							setPending(false);
							if (ok) onOpen();
						});
					}}
				>
					Open welcome wizard
				</button>
				<button
					type="button"
					className="mc-button"
					disabled={pending}
					onClick={() => {
						setPending(true);
						void store.replay().then((ok) => {
							setPending(false);
							if (!ok) {
								setMessage("Could not reset first-run state.");
								return;
							}
							try {
								owner.reset();
								setMessage(
									"First-run flag reset. Existing preferences are preserved.",
								);
							} catch {
								setMessage("Could not reset first-run flag.");
							}
						});
					}}
				>
					Reset first-run flag
				</button>
			</div>
			<p role="status">{message}</p>
		</fieldset>
	);
}

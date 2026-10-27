import { Schema } from "effect";
import { useEffect, useState } from "react";
import {
	AssistantSettings,
	defaultAssistantSettings,
} from "../../../../../../../packages/device/src/profiles/assistant-contracts";
import type { PublicModelRow } from "../../../../shared/agents";
import { AssistantControls } from "../../keys/AssistantEditor";
import { useAssistantText } from "../../keys/assistant-copy";

/** Update changes later turns. The host owns both persistence and turn admission. */
export function PersonaSettings({
	rows,
}: {
	readonly rows: readonly PublicModelRow[];
}) {
	const t = useAssistantText();
	const [value, setValue] = useState<AssistantSettings>();
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	useEffect(() => {
		let alive = true;
		const persona = window.quakeChat?.persona;
		if (persona)
			void persona
				.read()
				.then((v) => {
					if (alive) setValue(v);
				})
				.catch(() => {
					if (alive) setStatus(t("Assistant settings couldn't be loaded."));
				});
		return () => {
			alive = false;
		};
	}, [t]);
	if (!window.quakeChat?.persona) return null;
	return (
		<section aria-label={t("Assistant personality")} className="aw-scope">
			<h3>{t("Assistant personality")}</h3>
			{value && (
				<AssistantControls
					value={value}
					onChange={setValue}
					rows={rows}
					disabled={busy}
					promptLibrary
				/>
			)}
			<button
				type="button"
				className="mc-button"
				disabled={!value || busy || !Schema.is(AssistantSettings)(value)}
				onClick={() => {
					if (!value) return;
					setBusy(true);
					void window.quakeChat?.persona
						?.update(value)
						.then((saved) => {
							setValue(saved);
							setStatus(
								t("Assistant updated. New settings apply to the next turn."),
							);
						})
						.catch(() => setStatus(t("Assistant settings couldn't be saved.")))
						.finally(() => setBusy(false));
				}}
			>
				{t("Update")}
			</button>
			<button
				type="button"
				className="mc-button"
				disabled={busy}
				onClick={() =>
					setValue({ ...defaultAssistantSettings(), useAgent: false })
				}
			>
				{t("Reset")}
			</button>
			{status && <p role="status">{status}</p>}
		</section>
	);
}

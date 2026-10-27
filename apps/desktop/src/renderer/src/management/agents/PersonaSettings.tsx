import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
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
	const [generation, setGeneration] = useState<number | null>(null);
	const epoch = useRef(0);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState("");
	useEffect(() => {
		let alive = true;
		let destination: number | null | undefined;
		const bridge = window.quakeChat;
		const refresh = async () => {
			let identity = epoch.current;
			try {
				const selected = await bridge?.selection?.();
				if (!alive) return;
				const next = selected?.generation ?? null;
				if (
					destination === next ||
					(typeof next === "number" &&
						typeof destination === "number" &&
						next < destination)
				)
					return;
				destination = next;
				identity = ++epoch.current;
				setValue(undefined);
				setGeneration(next);
				setBusy(false);
				setStatus("");
				const saved = await bridge?.persona?.read();
				const latest = await bridge?.selection?.();
				if (
					alive &&
					epoch.current === identity &&
					(latest?.generation ?? null) === next
				)
					setValue(saved);
			} catch {
				if (alive && epoch.current === identity) {
					destination = undefined;
					setValue(undefined);
					setStatus(t("Assistant settings couldn't be loaded."));
				}
			}
		};
		void refresh();
		// The host selection also changes while this tab is hidden but mounted.
		const timer = setInterval(() => {
			void refresh();
		}, 300);
		return () => {
			alive = false;
			++epoch.current;
			clearInterval(timer);
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
					const identity = epoch.current;
					setBusy(true);
					void window.quakeChat?.persona
						?.update(value, generation)
						.then((saved) => {
							if (epoch.current !== identity) return;
							setValue(saved);
							setStatus(
								t("Assistant updated. New settings apply to the next turn."),
							);
						})
						.catch(() => {
							if (epoch.current === identity)
								setStatus(t("Assistant settings couldn't be saved."));
						})
						.finally(() => {
							if (epoch.current === identity) setBusy(false);
						});
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

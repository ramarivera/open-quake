import { useState } from "react";
import { canonicalProvider } from "../../../../../../packages/edge/src/ai/provider-catalog";
import {
	ASSISTANT_ENGINES,
	useAssistantCatalog,
} from "../keys/AssistantEditor";
import { AssistantLink } from "../keys/AssistantLink";
import { useAssistantText } from "../keys/assistant-copy";
import { Group, Row } from "../ui/Form";
export function AssistantProviderSettings() {
	const t = useAssistantText();
	const { view, status, setView } = useAssistantCatalog();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const rows = view?.models.default ?? [];
	const options = ASSISTANT_ENGINES.flatMap((engine) => {
		const matches = rows.filter(
			(r) =>
				canonicalProvider(r.provider) === engine.id && !r.settings?.mediaKind,
		);
		const row = matches.find((r) => r.role === "default") ?? matches[0];
		return row ? [{ ...engine, row }] : [];
	});
	const selected = rows.find((r) => r.role === "default");
	return (
		<Group title={t("Assistant")}>
			<Row label={t("AI Model Provider")} htmlFor="assistant-provider">
				{status ? (
					<span role="status">{status}</span>
				) : !options.length ? (
					<span role="status">—</span>
				) : (
					<select
						id="assistant-provider"
						disabled={busy || options.length < 2}
						value={
							options.find(
								(o) => o.id === canonicalProvider(selected?.provider ?? ""),
							)?.row.id ?? ""
						}
						onChange={(e) => {
							const row = rows.find((r) => r.id === e.target.value);
							if (!row || !view) return;
							setBusy(true);
							setError("");
							const { credentialAvailable: _ready, ...input } = row;
							void window.quakeAgents
								.request({
									type: "save-model",
									scope: "default",
									row: { ...input, role: "default" },
									secret: "",
									revision: view.revision,
								})
								.then((reply) => {
									if (reply._tag === "success") setView(reply.view);
									else setError(reply.message);
								})
								.catch(() => setError("AI provider couldn't be saved."))
								.finally(() => setBusy(false));
						}}
					>
						<option value="" disabled>
							{t("Select AI chat provider")}
						</option>
						{options.map((o) => (
							<option key={o.id} value={o.row.id}>
								{o.label}
								{o.row.credentialAvailable ? "" : " · credentials required"}
							</option>
						))}
					</select>
				)}
				<AssistantLink page="openclaw-ai">
					{t("Configure Models")}
				</AssistantLink>
			</Row>
			{error && <p role="alert">{error}</p>}
			<p>
				Only locally saved providers are shown. Agent-specific model overrides
				keep their own selection.
			</p>
		</Group>
	);
}

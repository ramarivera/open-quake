import { useEffect, useRef, useState } from "react";
import { ownModelRows } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import { providerDefaults } from "../../../../../../../packages/edge/src/agents/provider-defaults";
import type { AgentView, PublicModelRow } from "../../../../shared/agents";
import { ConfirmDialog } from "./Dialog";
import { reconcileModelDrafts, reconcileModelRow } from "./model-drafts";
import strings from "./strings.json";
import type { AgentRequest } from "./useAgents";

const t = strings.clawAIConfig;
function ModelTable({
	scope,
	rows,
	view,
	request,
	busy,
}: {
	readonly scope: string;
	readonly rows: readonly PublicModelRow[];
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
}) {
	const [drafts, setDrafts] = useState(rows);
	const baseline = useRef(rows);
	useEffect(() => {
		const previous = baseline.current;
		baseline.current = rows;
		setDrafts((current) => reconcileModelDrafts(current, previous, rows));
	}, [rows]);
	const [secrets, setSecrets] = useState<Readonly<Record<string, string>>>({});
	const [deleting, setDeleting] = useState<PublicModelRow>();
	const update = (next: PublicModelRow, propagate = false): void =>
		setDrafts((current) =>
			current.map((r) =>
				r.id === next.id
					? next
					: propagate && r.provider === next.provider
						? { ...r, baseUrl: next.baseUrl }
						: r,
			),
		);
	const save = async (
		row: PublicModelRow,
		previous?: PublicModelRow,
	): Promise<void> => {
		const { credentialAvailable, ...input } = row;
		const submittedSecret = Object.hasOwn(secrets, row.id)
			? (secrets[row.id] ?? "")
			: "";
		const reply = await request({
			type: "save-model",
			scope,
			row: input,
			secret: submittedSecret,
			revision: view.revision,
		});
		if (reply._tag === "success") {
			const saved = ownModelRows(reply.view.models, scope)?.find(
				(entry) => entry.id === row.id,
			);
			if (saved)
				setDrafts((current) =>
					current.map((entry) =>
						entry.id === row.id ? reconcileModelRow(entry, row, saved) : entry,
					),
				);
			setSecrets((current) =>
				current[row.id] === submittedSecret
					? { ...current, [row.id]: "" }
					: current,
			);
		} else if (previous)
			setDrafts((current) =>
				current.map((entry) =>
					entry.id === row.id && entry.role === row.role
						? { ...entry, role: previous.role }
						: entry,
				),
			);
	};
	return (
		<>
			<div style={{ overflowX: "auto" }}>
				<table className="mc-table">
					<caption>
						{scope === "default" ? t.defaultModelConfig : scope}
					</caption>
					<thead>
						<tr>
							{[
								t.role,
								t.providerCol,
								t.modelCol,
								t.baseUrlCol,
								t.credentials,
								t.maxTokensCol,
								t.actions,
							].map((label) => (
								<th key={label} scope="col">
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{drafts.map((row, index) => (
							<tr key={row.id}>
								<td>
									<select
										aria-label={`${t.role} ${scope} ${index + 1}`}
										value={row.role}
										disabled={busy}
										onChange={(event) => {
											const role = event.target.value;
											if (
												role !== "default" &&
												role !== "fallback" &&
												role !== "none"
											)
												return;
											const next: PublicModelRow = { ...row, role };
											update(next);
											if (row.model.trim() && row.provider.trim())
												void save(next, row);
										}}
									>
										<option value="none">{t.roleNone}</option>
										<option value="default">{t.roleDefault}</option>
										<option value="fallback">{t.roleFallback}</option>
									</select>
								</td>
								<td>
									<input
										aria-label={`${t.providerCol} ${scope} ${index + 1}`}
										value={row.provider}
										list={`agent-providers-${scope}`}
										onChange={(event) => {
											const provider = event.target.value;
											update({
												...row,
												provider,
												baseUrl:
													row.baseUrl ||
													providerDefaults.find((p) => p.id === provider)
														?.baseUrl ||
													"",
											});
										}}
									/>
								</td>
								<td>
									<input
										aria-label={`${t.modelCol} ${scope} ${index + 1}`}
										value={row.model}
										list={`agent-models-${scope}-${row.id}`}
										onChange={(event) => {
											const model = event.target.value;
											const provider =
												providerDefaults.find(
													(p) =>
														p.id === row.provider &&
														p.models.some((m) => m.id === model),
												) ??
												providerDefaults.find((p) =>
													p.models.some((m) => m.id === model),
												);
											const entry = provider?.models.find(
												(m) => m.id === model,
											);
											update({
												...row,
												model,
												provider: provider?.id ?? row.provider,
												maxTokens: entry?.maxTokens ?? row.maxTokens,
												baseUrl: row.baseUrl || provider?.baseUrl || "",
											});
										}}
									/>
									<datalist id={`agent-models-${scope}-${row.id}`}>
										{providerDefaults
											.find((p) => p.id === row.provider)
											?.models.map((m) => (
												<option key={m.id} value={m.id} />
											))}
									</datalist>
								</td>
								<td>
									<input
										type="url"
										aria-label={`${t.baseUrlCol} ${scope} ${index + 1}`}
										value={row.baseUrl}
										onChange={(event) =>
											update({ ...row, baseUrl: event.target.value }, true)
										}
									/>
								</td>
								<td>
									<span className="mc-badge">
										{row.credentialAvailable ? t.authAvailable : t.authMissing}
									</span>
									<input
										type="password"
										autoComplete="new-password"
										aria-label={`${t.credentials} ${scope} ${index + 1}`}
										placeholder={
											row.credentialAvailable
												? t.authOverridePlaceholder
												: t.authSavePlaceholder
										}
										value={
											Object.hasOwn(secrets, row.id)
												? (secrets[row.id] ?? "")
												: ""
										}
										onChange={(event) =>
											setSecrets({ ...secrets, [row.id]: event.target.value })
										}
									/>
								</td>
								<td>
									<input
										type="number"
										min={1}
										step={1}
										aria-label={`${t.maxTokensCol} ${scope} ${index + 1}`}
										value={row.maxTokens}
										onChange={(event) =>
											update({ ...row, maxTokens: event.target.valueAsNumber })
										}
									/>
								</td>
								<td>
									<button
										type="button"
										className="mc-button"
										disabled={
											busy ||
											!row.provider.trim() ||
											!row.model.trim() ||
											!Number.isSafeInteger(row.maxTokens) ||
											row.maxTokens < 1
										}
										onClick={() => void save(row)}
									>
										{t.saveRow}
									</button>
									<button
										type="button"
										className="mc-button"
										disabled={
											busy || (scope === "default" && drafts.length <= 1)
										}
										onClick={() => {
											if (!rows.some((r) => r.id === row.id)) {
												setDrafts((current) =>
													current.filter((r) => r.id !== row.id),
												);
												return;
											}
											setDeleting(row);
										}}
									>
										{t.delete}
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<datalist id={`agent-providers-${scope}`}>
				{providerDefaults.map((p) => (
					<option key={p.id} value={p.id} />
				))}
			</datalist>
			<button
				type="button"
				className="mc-button"
				disabled={busy}
				onClick={() =>
					setDrafts([
						...drafts,
						{
							id: crypto.randomUUID(),
							role: "none",
							provider: "",
							model: "",
							baseUrl: "",
							maxTokens: 4096,
							credentialAvailable: false,
						},
					])
				}
			>
				{t.addModel}
			</button>
			{deleting && (
				<ConfirmDialog
					title={t.deleteConfirmTitle}
					body={scope === "default" ? t.deleteConfirm : t.deleteConfirmChild}
					busy={busy}
					onClose={() => setDeleting(undefined)}
					onConfirm={async () => {
						const reply = await request({
							type: "delete-model",
							scope,
							id: deleting.id,
							confirmed: true,
							revision: view.revision,
						});
						if (reply._tag === "success") setDeleting(undefined);
					}}
				/>
			)}
		</>
	);
}
export function ModelsPanel({
	view,
	request,
	busy,
}: {
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
}) {
	const [tab, setTab] = useState("default");
	return (
		<section className="mc-panel">
			<header>
				<h2>{t.title}</h2>
				<p>{t.subtitle}</p>
			</header>
			<nav className="mc-tabs" aria-label={t.title}>
				<button
					type="button"
					className="mc-button"
					aria-selected={tab === "default"}
					role="tab"
					onClick={() => setTab("default")}
				>
					{t.defaultConfig}
				</button>
				<button
					type="button"
					className="mc-button"
					aria-selected={tab === "agents"}
					role="tab"
					onClick={() => setTab("agents")}
				>
					{t.agentsConfig}
				</button>
			</nav>
			<div hidden={tab !== "default"}>
				<ModelTable
					key="default"
					scope="default"
					rows={view.models.default ?? []}
					view={view}
					request={request}
					busy={busy}
				/>
			</div>
			<div hidden={tab !== "agents"}>
				<h3>{t.agentsModelConfig}</h3>
				<p>{t.agentsModelDescription}</p>
				{view.agents.map((agent) => (
					<details className="mc-card" key={agent.id}>
						<summary>
							{agent.emoji} {agent.name} <code>{agent.id}</code>{" "}
							<span className="mc-badge">
								{ownModelRows(view.models, agent.id)
									? t.customConfig
									: t.inherited}
							</span>
						</summary>
						<label className="mc-field">
							<input
								type="checkbox"
								checked={!ownModelRows(view.models, agent.id)}
								disabled={busy}
								onChange={(event) =>
									void request({
										type: "inherit",
										scope: agent.id,
										enabled: event.target.checked,
										revision: view.revision,
									})
								}
							/>
							{t.useDefaultConfig}
						</label>
						{ownModelRows(view.models, agent.id) ? (
							<ModelTable
								key={agent.id}
								scope={agent.id}
								rows={ownModelRows(view.models, agent.id) ?? []}
								view={view}
								request={request}
								busy={busy}
							/>
						) : (
							<div>
								<p>{t.currentDefaultConfig}</p>
								{(view.models.default ?? []).map((row) => (
									<p key={row.id}>
										<span className="mc-badge">
											{row.role === "default"
												? t.roleDefault
												: row.role === "fallback"
													? t.roleFallback
													: t.roleNone}
										</span>{" "}
										{row.provider} / {row.model || t.notSet} · {row.maxTokens}
									</p>
								))}
							</div>
						)}
					</details>
				))}
			</div>
		</section>
	);
}

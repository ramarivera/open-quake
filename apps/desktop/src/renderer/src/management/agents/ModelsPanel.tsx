import { useEffect, useRef, useState } from "react";
import {
	ownModelRows,
	sharesModelEndpoint,
} from "../../../../../../../packages/edge/src/agents/agents-invariants";
import { providerDefaults } from "../../../../../../../packages/edge/src/agents/provider-defaults";
import { providerSamplingValid } from "../../../../../../../packages/edge/src/ai/ai-sampling";
import {
	modelOptions,
	supportsWebSearch,
	volcBaseUrl,
} from "../../../../../../../packages/edge/src/ai/provider-catalog";
import type { AgentView, PublicModelRow } from "../../../../shared/agents";
import { DIRECT_CHAT_SCOPE, directChatModel } from "../chat/model-scope";
import { useAgentsCopy } from "./copy";
import { ConfirmDialog, format } from "./Dialog";
import {
	reconcileModelDrafts,
	reconcileModelRow,
	samplingInput,
	samplingValid,
	selectModelId,
	selectModelProvider,
	selectQwenGeneration,
} from "./model-drafts";
import type { AgentRequest } from "./useAgents";

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
	const strings = useAgentsCopy();
	const t = strings.clawAIConfig;
	const [drafts, setDrafts] = useState(rows);
	const baseline = useRef(rows);
	useEffect(() => {
		const previous = baseline.current;
		baseline.current = rows;
		setDrafts((current) => reconcileModelDrafts(current, previous, rows));
	}, [rows]);
	const [saveResult, setSaveResult] = useState("");
	const [secrets, setSecrets] = useState<Readonly<Record<string, string>>>({});
	const [deleting, setDeleting] = useState<PublicModelRow>();
	const update = (next: PublicModelRow, propagate = false): void =>
		setDrafts((current) =>
			current.map((r) =>
				r.id === next.id
					? next
					: propagate && sharesModelEndpoint(r, next)
						? { ...r, baseUrl: next.baseUrl }
						: r,
			),
		);
	const save = async (
		row: PublicModelRow,
		previous?: PublicModelRow,
	): Promise<void> => {
		if (!samplingValid(row)) return;
		const { credentialAvailable, ...input } = row;
		const submittedSecret = Object.hasOwn(secrets, row.id)
			? (secrets[row.id] ?? "")
			: "";
		setSaveResult("");
		const reply = await request({
			type: "save-model",
			scope,
			row: input,
			secret: submittedSecret,
			revision: view.revision,
		});
		setSaveResult(
			reply._tag === "success"
				? strings.administration.modelSaved
				: reply.message,
		);
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
			{busy && <p role="status">{strings.administration.modelLoading}</p>}
			{saveResult && <p role="status">{saveResult}</p>}
			<button
				type="button"
				className="mc-button"
				disabled={busy}
				onClick={() => void request({ type: "read" })}
			>
				{strings.administration.modelReload}
			</button>
			<div className="aw-table-wrap">
				<table className="mc-table aw-table">
					<caption className="visually-hidden">
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
								<td data-label={t.role}>
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
								<td data-label={t.providerCol}>
									<input
										aria-label={`${t.providerCol} ${scope} ${index + 1}`}
										value={row.provider}
										list={`agent-providers-${scope}`}
										onChange={(event) => {
											const provider = event.target.value;
											update({
												...selectModelProvider(row, provider),
												baseUrl:
													row.baseUrl ||
													providerDefaults.find((p) => p.id === provider)
														?.baseUrl ||
													"",
											});
										}}
									/>
								</td>
								<td data-label={t.modelCol}>
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
												...selectModelId(
													row,
													model,
													provider?.id ?? row.provider,
												),
												maxTokens: entry?.maxTokens ?? row.maxTokens,
												baseUrl: row.baseUrl || provider?.baseUrl || "",
											});
										}}
									/>
									<datalist id={`agent-models-${scope}-${row.id}`}>
										{modelOptions(row.provider, [row.model]).map((m) => (
											<option key={m.id} value={m.id} />
										))}
									</datalist>
								</td>
								<td data-label={t.baseUrlCol}>
									<input
										type="url"
										aria-label={`${t.baseUrlCol} ${scope} ${index + 1}`}
										value={row.baseUrl}
										onChange={(event) =>
											update({ ...row, baseUrl: event.target.value }, true)
										}
									/>
									{row.provider === "qwen" && (
										<label className="aw-provider-field">
											{t.generationType}
											<select
												aria-label={`${t.generationType} ${scope} ${index + 1}`}
												value={row.settings?.mediaKind ?? "chat"}
												onChange={(event) => {
													const kind = event.target.value;
													update(
														selectQwenGeneration(
															row,
															kind === "image" || kind === "video"
																? kind
																: "chat",
														),
													);
												}}
											>
												<option value="chat">{t.chatGeneration}</option>
												<option value="image">{t.imageGeneration}</option>
												<option value="video">{t.videoGeneration}</option>
											</select>
										</label>
									)}
									{row.provider === "volc" && (
										<label className="aw-provider-field">
											{t.entryMethod}
											<select
												aria-label={`${t.entryMethod} ${scope} ${index + 1}`}
												value={row.settings?.entryMethod ?? "inference"}
												onChange={(event) => {
													const entryMethod =
														event.target.value === "agent"
															? "agent"
															: "inference";
													update({
														...row,
														settings: { ...row.settings, entryMethod },
														baseUrl: volcBaseUrl(entryMethod),
													});
												}}
											>
												<option value="inference">{t.inference}</option>
												<option value="agent">{t.agentEntry}</option>
											</select>
										</label>
									)}
									{(row.provider === "coze" || row.provider === "volc") && (
										<label className="aw-provider-field">
											{row.provider === "coze" ? t.botId : t.endpointBotId}
											<input
												aria-label={`${t.botId} ${scope} ${index + 1}`}
												value={row.settings?.botId ?? ""}
												onChange={(event) => {
													const { botId: _botId, ...settings } =
														row.settings ?? {};
													const botId = event.target.value.trim();
													update({
														...row,
														settings: {
															...settings,
															...(botId ? { botId } : {}),
														},
													});
												}}
											/>
										</label>
									)}
									{(row.provider === "openai" || row.provider === "qwen") && (
										<label className="aw-provider-option">
											<input
												type="checkbox"
												checked={row.settings?.filesEnabled ?? false}
												onChange={(event) =>
													update({
														...row,
														settings: {
															...row.settings,
															filesEnabled: event.target.checked,
														},
													})
												}
											/>
											{t.providerFiles}
										</label>
									)}
									{supportsWebSearch(row.provider, row.model) && (
										<label className="aw-provider-option">
											<input
												type="checkbox"
												checked={row.controls?.webSearch ?? false}
												onChange={(event) =>
													update({
														...row,
														controls: {
															...row.controls,
															webSearch: event.target.checked,
															...(row.provider === "qwen"
																? {
																		searchOptions: event.target.checked
																			? { enable_source: true }
																			: undefined,
																	}
																: {}),
														},
													})
												}
											/>
											{t.providerSearch}
										</label>
									)}
								</td>
								<td data-label={t.credentials}>
									<span className="aw-credential">
										<span
											className="cw-dot"
											data-tone={
												row.credentialAvailable ? "success" : "neutral"
											}
											aria-hidden="true"
										/>
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
								<td data-label={t.maxTokensCol}>
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
									<details className="aw-sampling">
										<summary>{t.advanced}</summary>
										<p id={`sampling-hint-${scope}-${row.id}`}>
											{t.samplingDefault}
										</p>
										{!providerSamplingValid(row) ? (
											<p
												id={`sampling-policy-${scope}-${row.id}`}
												className="aw-field-error"
											>
												{t.samplingUnsupported}
											</p>
										) : null}
										{(["temperature", "topP"] as const).map((field) => {
											const value = row[field];
											const maximum = field === "temperature" ? 2 : 1;
											const invalid =
												value !== undefined &&
												(!Number.isFinite(value) ||
													value < 0 ||
													value > maximum);
											const id = `sampling-${scope}-${row.id}-${field}`;
											return (
												<div key={field}>
													<label htmlFor={id}>{t[field]}</label>
													<input
														id={id}
														type="number"
														min={0}
														max={maximum}
														step="any"
														disabled={busy}
														aria-label={`${t[field]} ${scope} ${index + 1}`}
														aria-invalid={
															invalid || !providerSamplingValid(row)
														}
														aria-describedby={`sampling-hint-${scope}-${row.id}${invalid ? ` ${id}-error` : ""}${!providerSamplingValid(row) ? ` sampling-policy-${scope}-${row.id}` : ""}`}
														value={
															value === undefined || Number.isNaN(value)
																? ""
																: value
														}
														onChange={(event) =>
															update({
																...row,
																[field]: samplingInput(
																	event.target.value,
																	event.target.validity.badInput,
																),
															})
														}
													/>
													{invalid ? (
														<p id={`${id}-error`} className="aw-field-error">
															{field === "temperature"
																? t.temperatureInvalid
																: t.topPInvalid}
														</p>
													) : null}
												</div>
											);
										})}
									</details>
								</td>
								<td className="aw-table-actions" data-label={t.actions}>
									<button
										type="button"
										className="mc-button"
										disabled={
											busy ||
											!row.provider.trim() ||
											!row.model.trim() ||
											!Number.isSafeInteger(row.maxTokens) ||
											row.maxTokens < 1 ||
											!samplingValid(row)
										}
										onClick={() => void save(row)}
									>
										{t.saveRow}
									</button>
									<button
										type="button"
										className="mc-button"
										data-variant="quiet"
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
				className="mc-button aw-add-row"
				data-variant="quiet"
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
	const strings = useAgentsCopy();
	const t = strings.clawAIConfig;
	const [tab, setTab] = useState("default");
	const effective = directChatModel(view.models);
	const mainOverride = Boolean(ownModelRows(view.models, DIRECT_CHAT_SCOPE));
	return (
		<section className="mc-panel aw-models">
			<header className="aw-section-head">
				<div>
					<h2>{t.title}</h2>
					<p>{t.subtitle}</p>
				</div>
			</header>
			<p className="aw-effective" role="status">
				<span
					className="cw-dot"
					data-tone={effective.ready ? "success" : "warning"}
					aria-hidden="true"
				/>
				<span>
					{effective.row
						? format(effective.ready ? t.effective : t.effectiveNoKey, {
								model: `${effective.row.provider} / ${effective.row.model}`,
							})
						: t.effectiveNone}
					{mainOverride && (
						<span className="cw-muted"> · {t.mainOverride}</span>
					)}
				</span>
			</p>
			<nav className="mc-tabs aw-subtabs" aria-label={t.title}>
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
				<p className="cw-muted aw-tab-intro">{t.agentsModelDescription}</p>
				{view.agents.map((agent) => (
					<details className="aw-scope" key={agent.id}>
						<summary>
							<span aria-hidden="true">{agent.emoji}</span>{" "}
							<span className="aw-row-title">{agent.name}</span>{" "}
							<code className="cw-code">{agent.id}</code>{" "}
							<span
								className="mc-badge"
								data-tone={
									ownModelRows(view.models, agent.id) ? "accent" : "neutral"
								}
							>
								{ownModelRows(view.models, agent.id)
									? t.customConfig
									: t.inherited}
							</span>
						</summary>
						<label className="cw-check">
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
							<div className="aw-inherited">
								<p className="cw-muted">{t.currentDefaultConfig}</p>
								{(view.models.default ?? []).map((row) => (
									<p key={row.id}>
										<span className="mc-badge" data-tone="neutral">
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

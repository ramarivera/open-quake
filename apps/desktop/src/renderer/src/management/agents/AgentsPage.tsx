import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	type Agent,
	type AgentsBridge,
	type AgentView,
	SLOT_CODES,
	type Slots,
} from "../../../../shared/agents";
import { AgentWizard } from "./AgentWizard";
import { ConfirmDialog, format } from "./Dialog";
import { ModelsPanel } from "./ModelsPanel";
import { RuntimeIndicator } from "./RuntimeIndicator";
import { SkillsPanel } from "./SkillsPanel";
import { reconcileSlotDrafts } from "./slot-drafts";
import strings from "./strings.json";
import { type AgentRequest, useAgents } from "./useAgents";

const t = strings.clawAgentManagement;
export type AgentsTab = "sessions" | "agents" | "ai" | "settings";
function Roster({
	view,
	request,
	busy,
}: {
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
}) {
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState("all");
	const [selected, setSelected] = useState("main");
	const [wizard, setWizard] = useState<{ readonly agent: Agent | undefined }>();
	const [deleting, setDeleting] = useState<Agent>();
	const [tab, setTab] = useState("loadout");
	const active = view.agents.find((a) => a.id === selected) ?? view.agents[0];
	useEffect(() => {
		if (!view.agents.some((a) => a.id === selected))
			setSelected(view.agents[0]?.id ?? "");
	}, [view.agents, selected]);
	const visible = view.agents.filter(
		(a) =>
			(filter === "all" || a.id !== "main") &&
			[a.id, a.name].join(" ").toLowerCase().includes(search.toLowerCase()),
	);
	return (
		<>
			<header className="mc-toolbar">
				<div>
					<h2>{t.title}</h2>
					<p>{t.initWorkspaceHint}</p>
				</div>
				<button
					type="button"
					className="mc-button"
					onClick={() => setWizard({ agent: undefined })}
				>
					{t.createAgent}
				</button>
			</header>
			<nav className="mc-tabs" aria-label={t.managementViews}>
				<button
					type="button"
					className="mc-button"
					aria-selected={tab === "loadout"}
					role="tab"
					onClick={() => setTab("loadout")}
				>
					{t.loadoutTab}
				</button>
				<button
					type="button"
					className="mc-button"
					aria-selected={tab === "skills"}
					role="tab"
					onClick={() => setTab("skills")}
				>
					{t.skillManagementTab}
				</button>
			</nav>
			<div hidden={tab !== "loadout"} className="mc-split">
				<section className="mc-aside" aria-label="Agents">
					<header className="mc-toolbar">
						<h3>
							Agents{" "}
							<span className="mc-badge">
								{format(t.agentCount, { count: view.agents.length })}
							</span>
						</h3>
						<button
							type="button"
							className="mc-button"
							disabled={busy}
							onClick={() => void request({ type: "read" })}
						>
							{t.refresh}
						</button>
					</header>
					<label className="mc-field">
						{t.searchPlaceholder}
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t.searchPlaceholder}
						/>
					</label>
					<div className="mc-toolbar">
						{["all", "local"].map((value) => (
							<button
								type="button"
								className="mc-button"
								key={value}
								aria-pressed={filter === value}
								onClick={() => setFilter(value)}
							>
								{value === "all" ? t.all : t.local}
							</button>
						))}
					</div>
					{visible.map((agent) => (
						<article
							className="mc-card"
							data-selected={selected === agent.id}
							key={agent.id}
						>
							<div className="mc-toolbar">
								<button
									type="button"
									className="mc-button"
									aria-pressed={selected === agent.id}
									onClick={() => setSelected(agent.id)}
								>
									<span aria-hidden="true">{agent.emoji}</span> {agent.name}
								</button>
								<span className="mc-badge">
									{agent.id === "main" ? t.system : t.local}
								</span>
							</div>
							<code>{agent.id}</code>
							<div className="mc-toolbar">
								{agent.id === "main" ? (
									<span>🔒 {t.protectedAgent}</span>
								) : (
									<>
										<button
											type="button"
											className="mc-button"
											aria-label={`${t.editAgent} ${agent.name}`}
											onClick={() => setWizard({ agent })}
										>
											{t.edit}
										</button>
										<button
											type="button"
											className="mc-button"
											aria-label={`${t.deleteAgent} ${agent.name}`}
											onClick={() => setDeleting(agent)}
										>
											{t.delete}
										</button>
									</>
								)}
							</div>
						</article>
					))}
					{visible.length === 0 && (
						<div className="mc-empty">
							<p>
								{search
									? format(t.noSearchResults, { query: search })
									: t.noAgents}
							</p>
							<button
								type="button"
								className="mc-button"
								onClick={() =>
									search ? setSearch("") : setWizard({ agent: undefined })
								}
							>
								{search ? t.clearSearch : t.createAgent}
							</button>
						</div>
					)}
				</section>
				<section className="mc-panel" aria-label={t.equippedSkills}>
					{active ? (
						<>
							<header className="mc-toolbar">
								<span style={{ fontSize: 36 }} aria-hidden="true">
									{active.emoji}
								</span>
								<div>
									<h3>{active.name}</h3>
									<code>{active.id}</code>
								</div>
							</header>
							<h3>{t.equippedSkills}</h3>
							<p>{t.equippedSkillsHint}</p>
							{view.skills
								.filter((s) => s.owner === active.id)
								.map((skill) => (
									<article className="mc-card" key={skill.folder}>
										<strong>{skill.name}</strong>
										<p>{skill.description}</p>
									</article>
								))}
							{!view.skills.some((s) => s.owner === active.id) && (
								<div className="mc-empty">{t.noEquippedSkills}</div>
							)}
							<h3>Workspace</h3>
							<div className="mc-toolbar">
								{Object.keys(active.files).map((file) => (
									<span className="mc-badge" key={file}>
										{file}
									</span>
								))}
							</div>
							<p>
								{format(t.filesSkillsCount, {
									files: Object.keys(active.files).length,
									skills: view.skills.filter((s) => s.owner === active.id)
										.length,
								})}
							</p>
						</>
					) : (
						<p>{t.selectAgentHint}</p>
					)}
				</section>
			</div>
			<div hidden={tab !== "skills"}>
				<SkillsPanel view={view} request={request} busy={busy} />
			</div>
			{wizard && (
				<AgentWizard
					agent={wizard.agent}
					view={view}
					request={request}
					onClose={() => setWizard(undefined)}
				/>
			)}
			{deleting && (
				<ConfirmDialog
					title={t.deleteConfirmTitle}
					body={format(t.deleteConfirmBody, { name: deleting.name })}
					busy={busy}
					onClose={() => setDeleting(undefined)}
					onConfirm={async () => {
						const reply = await request({
							type: "delete",
							id: deleting.id,
							confirmed: true,
						});
						if (reply._tag === "success") setDeleting(undefined);
					}}
				/>
			)}
		</>
	);
}
function PanelSettings({
	view,
	request,
	busy,
	children,
}: {
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
	readonly children: ReactNode;
}) {
	const [slots, setSlots] = useState<Slots>(view.slots);
	const previousSlots = useRef(view.slots);
	const d = strings.dkclaw;
	useEffect(() => {
		const previous = previousSlots.current;
		previousSlots.current = view.slots;
		setSlots((draft) =>
			reconcileSlotDrafts(
				draft,
				previous,
				view.slots,
				view.agents.map((agent) => agent.id),
			),
		);
	}, [view.slots, view.agents]);
	return (
		<>
			<section className="mc-panel">
				<header>
					<h2>DK-Claw</h2>
					<p>{d.cardBlurb}</p>
				</header>
				<div className="mc-grid">
					{SLOT_CODES.map((code) => (
						<label key={code} className="mc-card mc-field">
							{code}
							<select
								aria-label={`DK-Claw ${code}`}
								value={slots[code]}
								disabled={busy}
								onChange={(event) => {
									const agent = view.agents.find(
										(a) => a.id === event.target.value,
									);
									if (agent) setSlots({ ...slots, [code]: agent.id });
								}}
							>
								{view.agents.map((agent) => (
									<option value={agent.id} key={agent.id}>
										{agent.emoji} {agent.name}
									</option>
								))}
							</select>
						</label>
					))}
				</div>
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={() =>
						void request({ type: "sync-panel", slots, revision: view.revision })
					}
				>
					{busy ? d.actionSyncing : d.actionSync}
				</button>
				{view.progress.percent > 0 && (
					<div role="status">
						<progress
							max={100}
							value={view.progress.percent}
							aria-label={d.actionSync}
						/>
						<span>
							{view.progress.percent}% · {view.progress.stage}
						</span>
						{view.progress.stage === "done" && (
							<p>
								{view.progress.deviceApplied
									? d.toastSyncSuccess
									: d.toastSyncDeferred}
							</p>
						)}
					</div>
				)}
			</section>
			{children}
		</>
	);
}
export interface AgentsPageProps {
	readonly initialTab?: AgentsTab;
	readonly activation?: { readonly tab: AgentsTab; readonly sequence: number };
	readonly children?: ReactNode;
	readonly bridge?: AgentsBridge;
}
export function AgentsPage({
	initialTab = "sessions",
	activation,
	children,
	bridge,
}: AgentsPageProps) {
	const { view, error, busy, request } = useAgents(
		bridge ?? window.quakeAgents,
	);
	const [tab, setTab] = useState<AgentsTab>(initialTab);
	useEffect(
		() => setTab(activation?.tab ?? initialTab),
		[initialTab, activation],
	);
	const tabs = [
		{ id: "sessions", label: strings.clawControlPanel.sessionsTab },
		{ id: "agents", label: strings.clawControlPanel.agentsTab },
		{ id: "ai", label: strings.clawControlPanel.aiConfig },
		{ id: "settings", label: strings.clawControlPanel.settings },
	] as const;
	return (
		<div className="agent-workbench">
			<header className="mc-toolbar">
				<div>
					<h1>{strings.clawControlPanel.agentsTab}</h1>
					<p>{t.initWorkspaceHint}</p>
				</div>
				{view && <RuntimeIndicator runtime={view.runtime} request={request} />}
			</header>
			<div
				className="mc-tabs"
				role="tablist"
				onKeyDown={(event) => {
					if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
						return;
					event.preventDefault();
					const index = tabs.findIndex((item) => item.id === tab);
					const next =
						tabs[
							event.key === "Home"
								? 0
								: event.key === "End"
									? tabs.length - 1
									: (index +
											(event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
										tabs.length
						];
					if (next) {
						setTab(next.id);
						document.getElementById(`agents-tab-${next.id}`)?.focus();
					}
				}}
				aria-label={strings.clawControlPanel.aria}
			>
				{tabs.map((item) => (
					<button
						type="button"
						className="mc-button"
						key={item.id}
						id={`agents-tab-${item.id}`}
						tabIndex={tab === item.id ? 0 : -1}
						aria-selected={tab === item.id}
						role="tab"
						aria-controls={`agents-${item.id}`}
						onClick={() => setTab(item.id)}
					>
						{item.label}
					</button>
				))}
			</div>
			{error && (
				<p role="alert">
					{error}{" "}
					<button
						type="button"
						className="mc-button"
						onClick={() => void request({ type: "read" })}
					>
						{t.retry}
					</button>
				</p>
			)}
			{!view ? (
				<section
					className="mc-panel"
					aria-busy={!error}
					aria-label={t.loadingAgentMd}
				>
					{[1, 2, 3, 4].map((n) => (
						<div
							key={n}
							className="mc-card"
							aria-hidden="true"
							style={{ height: 48, opacity: 0.35 }}
						/>
					))}
					<p role="status">{error ? t.retry : t.loadingAgentMd}</p>
				</section>
			) : (
				<>
					<section
						id="agents-sessions"
						role="tabpanel"
						aria-labelledby="agents-tab-sessions"
						hidden={tab !== "sessions"}
						className="mc-panel"
					>
						<header className="mc-toolbar">
							<h2>{strings.clawSessions.title}</h2>
							<span className="mc-badge">
								{format(t.agentCount, { count: view.agents.length })} ·{" "}
								{view.runtime.status === "ready"
									? strings.clawSessions.serviceReady
									: strings.clawSessions.serviceStopped}
							</span>
						</header>
						{view.runtime.status !== "ready" ? (
							<div className="mc-empty">
								<h3>
									{view.runtime.available
										? strings.clawSessions.offlineTitle
										: "No agent runtime is installed"}
								</h3>
								<p>{strings.clawSessions.offlineHint}</p>
								<RuntimeIndicator
									runtime={view.runtime}
									request={request}
									large
								/>
							</div>
						) : (
							<div className="mc-grid">
								{view.agents.map((agent) => (
									<article className="mc-card" key={agent.id}>
										<span aria-hidden="true" style={{ fontSize: 32 }}>
											{agent.emoji}
										</span>
										<h3>{agent.name}</h3>
										<code>{agent.id}</code>
										<p>
											{format(t.filesSkillsCount, {
												files: Object.keys(agent.files).length,
												skills: view.skills.filter((s) => s.owner === agent.id)
													.length,
											})}
										</p>
										<button
											type="button"
											className="mc-button"
											onClick={() => setTab("agents")}
										>
											{t.title}
										</button>
									</article>
								))}
							</div>
						)}
					</section>
					<section
						id="agents-agents"
						role="tabpanel"
						aria-labelledby="agents-tab-agents"
						hidden={tab !== "agents"}
					>
						<Roster view={view} request={request} busy={busy} />
					</section>
					<section
						id="agents-ai"
						role="tabpanel"
						aria-labelledby="agents-tab-ai"
						hidden={tab !== "ai"}
					>
						<ModelsPanel view={view} request={request} busy={busy} />
					</section>
					<section
						id="agents-settings"
						role="tabpanel"
						aria-labelledby="agents-tab-settings"
						hidden={tab !== "settings"}
					>
						<PanelSettings view={view} request={request} busy={busy}>
							{children}
						</PanelSettings>
					</section>
				</>
			)}
		</div>
	);
}

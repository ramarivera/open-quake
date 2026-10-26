import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	type Agent,
	type AgentsBridge,
	type AgentView,
	SLOT_CODES,
	type Slots,
} from "../../../../shared/agents";
import { useAppLocale } from "../../i18n";
import { directChatModel } from "../chat/model-scope";
import { ConversationWorkspace } from "../chat/Workspace";
import "../chat/workspace.css";
import "./agents.css";
import { AdministrationPanel } from "./AdministrationPanel";
import { AgentWizard } from "./AgentWizard";
import { useAgentsCopy } from "./copy";
import { ConfirmDialog, format } from "./Dialog";
import { ModelsPanel } from "./ModelsPanel";
import { RuntimeIndicator } from "./RuntimeIndicator";
import { SkillsPanel } from "./SkillsPanel";
import { SKILL_DRAG_TYPE, transferSkill } from "./skill-transfer";
import { reconcileSlotDrafts } from "./slot-drafts";
import { type AgentRequest, useAgents } from "./useAgents";

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
	const strings = useAgentsCopy();
	const t = strings.clawAgentManagement;
	const [search, setSearch] = useState("");
	const [layout, setLayout] = useState("grid");
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
	const equipped = active
		? view.skills.filter((s) => s.owner === active.id)
		: [];
	return (
		<>
			<header className="aw-section-head">
				<div>
					<h2>{t.title}</h2>
					<p>{t.libraryIntro}</p>
				</div>
				<button
					type="button"
					className="mc-button"
					data-primary={tab === "loadout" || undefined}
					onClick={() => setWizard({ agent: undefined })}
				>
					{t.createAgent}
				</button>
			</header>
			<div
				className="mc-tabs aw-subtabs"
				role="tablist"
				aria-label={t.managementViews}
			>
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
			</div>
			<div hidden={tab !== "loadout"} className="aw-split">
				<section className="aw-list" aria-label={t.agentsList}>
					<div className="aw-list-tools">
						<label className="mc-field aw-search">
							<span className="visually-hidden">{t.searchPlaceholder}</span>
							<input
								type="search"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								placeholder={t.searchPlaceholder}
							/>
						</label>
						<fieldset className="aw-segmented">
							<legend className="visually-hidden">{t.filter}</legend>
							{["all", "local"].map((value) => (
								<button
									type="button"
									key={value}
									aria-pressed={filter === value}
									onClick={() => setFilter(value)}
								>
									{value === "all" ? t.all : t.local}
								</button>
							))}
						</fieldset>
					</div>
					<p className="cw-muted aw-count">
						{format(t.agentCount, { count: view.agents.length })}
						<button
							type="button"
							className="cw-inline-action"
							disabled={busy}
							onClick={() => void request({ type: "read" })}
						>
							{t.refresh}
						</button>
					</p>
					<fieldset className="aw-segmented">
						<legend>{strings.administration.view}</legend>
						{["grid", "list"].map((mode) => (
							<button
								key={mode}
								type="button"
								aria-pressed={layout === mode}
								onClick={() => setLayout(mode)}
							>
								{mode === "grid"
									? strings.administration.grid
									: strings.administration.list}
							</button>
						))}
					</fieldset>
					<ul className="aw-rows" data-layout={layout}>
						{visible.map((agent) => (
							<li
								className="mc-card aw-row"
								data-selected={active?.id === agent.id}
								key={agent.id}
								onDragOver={(event) => {
									if (
										agent.id !== "main" &&
										event.dataTransfer.types.includes(SKILL_DRAG_TYPE)
									)
										event.preventDefault();
								}}
								onDrop={(event) => {
									event.preventDefault();
									transferSkill(
										event.dataTransfer.getData(SKILL_DRAG_TYPE),
										agent.id,
										view,
										request,
									);
								}}
							>
								<button
									type="button"
									className="aw-row-main"
									aria-pressed={active?.id === agent.id}
									onClick={() => setSelected(agent.id)}
								>
									<span className="aw-emoji" aria-hidden="true">
										{agent.emoji || "🤖"}
									</span>
									<span className="aw-row-text">
										<span className="aw-row-title">{agent.name}</span>
										<code className="aw-row-meta">{agent.id}</code>
									</span>
									<span className="mc-badge" data-tone="neutral">
										{agent.id === "main" ? t.system : t.local}
									</span>
								</button>
								{agent.id !== "main" && (
									<span className="aw-row-actions">
										<button
											type="button"
											className="mc-button"
											data-variant="quiet"
											aria-label={`${t.editAgent} ${agent.name}`}
											onClick={() => setWizard({ agent })}
										>
											{t.edit}
										</button>
										<button
											type="button"
											className="mc-button"
											data-variant="quiet"
											aria-label={`${t.deleteAgent} ${agent.name}`}
											onClick={() => setDeleting(agent)}
										>
											{t.delete}
										</button>
									</span>
								)}
							</li>
						))}
					</ul>
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
				<section className="aw-detail" aria-label={t.equippedSkills}>
					{active ? (
						<>
							<header className="aw-detail-head">
								<span className="aw-emoji aw-emoji-lg" aria-hidden="true">
									{active.emoji || "🤖"}
								</span>
								<div>
									<h3>{active.name}</h3>
									<p className="cw-muted">
										<code className="cw-code">{active.id}</code>
										{active.id === "main" && <> · {t.protectedAgent}</>}
									</p>
								</div>
							</header>
							<h4>{t.equippedSkills}</h4>
							<p className="cw-muted">{t.equippedSkillsHint}</p>
							{equipped.length > 0 ? (
								<ul className="aw-plain-list">
									{equipped.map((skill) => (
										<li key={skill.folder}>
											<strong>{skill.name}</strong>
											<span className="cw-muted">
												{skill.description || t.noDescription}
											</span>
										</li>
									))}
								</ul>
							) : (
								<p className="aw-none">{t.noEquippedSkills}</p>
							)}
							<h4>{t.workspace}</h4>
							<p className="cw-muted">
								{format(t.filesSkillsCount, {
									files: Object.keys(active.files).length,
									skills: equipped.length,
								})}
							</p>
							<ul className="aw-files">
								{Object.keys(active.files).map((file) => (
									<li key={file}>
										<code className="cw-code">{file}</code>
									</li>
								))}
							</ul>
						</>
					) : (
						<p className="cw-muted">{t.selectAgentHint}</p>
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
	active,
	view,
	request,
	busy,
	children,
}: {
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
	readonly children: ReactNode;
	readonly active: boolean;
}) {
	const strings = useAgentsCopy();
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
	const dirty = SLOT_CODES.some((code) => slots[code] !== view.slots[code]);
	return (
		<>
			<section className="mc-panel aw-slots" aria-labelledby="aw-slots-title">
				<header className="aw-section-head">
					<div>
						<h2 id="aw-slots-title">{d.title}</h2>
						<p>{d.cardBlurb}</p>
					</div>
					<button
						type="button"
						className="mc-button"
						data-primary
						disabled={busy}
						onClick={() =>
							void request({
								type: "sync-panel",
								slots,
								revision: view.revision,
							})
						}
					>
						{busy ? d.actionSyncing : d.actionSync}
					</button>
				</header>
				<ul className="aw-slot-list">
					{SLOT_CODES.map((code) => (
						<li key={code}>
							<label className="aw-slot">
								<span className="aw-slot-key">
									{format(d.keyLabel, { code })}
									{slots[code] !== view.slots[code] && (
										<span className="mc-badge" data-tone="warning">
											{d.unsynced}
										</span>
									)}
								</span>
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
						</li>
					))}
				</ul>
				{dirty && <p className="cw-muted">{d.pendingHint}</p>}
				{view.progress.percent > 0 && (
					<div role="status" className="aw-progress">
						<progress
							max={100}
							value={view.progress.percent}
							aria-label={d.actionSync}
						/>
						<span className="cw-muted">
							{view.progress.percent}% · {d.stages[view.progress.stage]}
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
			<AdministrationPanel
				active={active}
				view={view}
				request={request}
				busy={busy}
			/>
			{children}
		</>
	);
}
export interface AgentsPageProps {
	readonly initialTab?: AgentsTab;
	readonly activation?: { readonly tab: AgentsTab; readonly sequence: number };
	readonly children?: ReactNode;
	readonly bridge?: AgentsBridge;
	readonly developmentDiagnostics?: boolean;
}
export function AgentsPage({
	initialTab = "sessions",
	activation,
	children,
	bridge,
	developmentDiagnostics = import.meta.env.DEV &&
		import.meta.env.VITE_ENABLE_CLAW_LOCAL_MODEL_TEST === "true",
}: AgentsPageProps) {
	const { locale } = useAppLocale();
	const strings = useAgentsCopy();
	const t = strings.clawAgentManagement;
	const { view, error, busy, request } = useAgents(
		bridge ?? window.quakeAgents,
	);
	const [tab, setTab] = useState<AgentsTab>(initialTab);
	useEffect(
		() => setTab(activation?.tab ?? initialTab),
		[initialTab, activation],
	);
	// Narrow windows scroll the tab row horizontally; keep the selected tab
	// visible after selection and resizes without moving the page vertically.
	const tabRow = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const row = tabRow.current;
		if (!row) return;
		const reveal = () => {
			const selected = row.querySelector<HTMLElement>(`#agents-tab-${tab}`);
			if (!selected) return;
			const start = selected.offsetLeft - row.offsetLeft;
			const end = start + selected.offsetWidth;
			if (start < row.scrollLeft) row.scrollLeft = start;
			else if (end > row.scrollLeft + row.clientWidth)
				row.scrollLeft = end - row.clientWidth;
		};
		reveal();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(reveal);
		observer.observe(row);
		return () => observer.disconnect();
	}, [tab]);
	useEffect(() => {
		if (tab === "settings") void request({ type: "read" });
	}, [tab, request]);
	useEffect(() => {
		const reload = () => {
			if (tab === "settings") void request({ type: "read" });
		};
		window.addEventListener("agents:settings-invalidated", reload);
		return () =>
			window.removeEventListener("agents:settings-invalidated", reload);
	}, [tab, request]);
	const tabs = [
		{ id: "sessions", label: strings.clawControlPanel.sessionsTab },
		{ id: "agents", label: strings.clawControlPanel.localLibraryTab },
		{ id: "ai", label: strings.clawControlPanel.aiConfig },
		{ id: "settings", label: strings.clawControlPanel.settings },
	] as const;
	return (
		<div className="agent-workbench">
			<header className="aw-header">
				<div>
					<p className="mc-page-kicker">{strings.clawControlPanel.kicker}</p>
					<h1>{strings.clawControlPanel.agentsTab}</h1>
					<p>{strings.clawControlPanel.libraryHint}</p>
				</div>
				{view && <RuntimeIndicator runtime={view.runtime} request={request} />}
			</header>
			<div
				ref={tabRow}
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
			<section
				id="agents-sessions"
				role="tabpanel"
				aria-labelledby="agents-tab-sessions"
				hidden={tab !== "sessions"}
			>
				<SessionsRuntime view={view} busy={busy} request={request} />
				{developmentDiagnostics && (
					<section
						className="mc-panel"
						aria-label={strings.administration.localDiagnostic}
					>
						<h2>{strings.administration.localDiagnostic}</h2>
						<p>{strings.administration.deprecated}</p>
					</section>
				)}
				<ConversationWorkspace
					locale={locale}
					model={directChatModel(view?.models)}
					configurationLoading={!view && !error}
					configurationError={!view ? error : undefined}
					onRetryConfiguration={() => void request({ type: "read" })}
					onOpenSettings={() => {
						setTab("ai");
						document.getElementById("agents-tab-ai")?.focus();
					}}
				/>
			</section>
			{error && tab !== "sessions" && (
				<div role="alert" className="cw-banner">
					<p>{error}</p>
					<button
						type="button"
						className="mc-button"
						onClick={() => void request({ type: "read" })}
					>
						{t.retry}
					</button>
				</div>
			)}
			{!view ? (
				<section
					hidden={tab === "sessions"}
					className="mc-panel"
					aria-busy={!error}
					aria-label={t.loadingAgentMd}
				>
					<p role="status">{error ? t.retry : t.loadingAgentMd}</p>
					{!error && (
						<ul className="aw-rows" aria-label="Loading agents">
							{[0, 1, 2, 3].map((row) => (
								<li className="aw-skeleton" key={row} aria-hidden="true" />
							))}
						</ul>
					)}
				</section>
			) : (
				<>
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
						<PanelSettings
							active={tab === "settings"}
							view={view}
							request={request}
							busy={busy}
						>
							{children}
						</PanelSettings>
					</section>
				</>
			)}
		</div>
	);
}

function SessionsRuntime({
	view,
	busy,
	request,
}: {
	readonly view: AgentView | undefined;
	readonly busy: boolean;
	readonly request: AgentRequest;
}) {
	const t = useAgentsCopy();
	const runtime = view?.runtime;
	const mode = !runtime
		? "detecting"
		: runtime.status === "ready"
			? "ready"
			: runtime.status === "stopped"
				? "offline"
				: runtime.status;
	return (
		<div className="aw-session-runtime" data-session-mode={mode}>
			<header className="aw-section-head">
				<div>
					<h2>{t.clawControlPanel.sessionsTab}</h2>
					<span role="status">
						{runtime
							? t.openclawRuntimeIndicator[
									runtime.status === "ready"
										? "statusReady"
										: runtime.status === "starting"
											? "statusStarting"
											: runtime.status === "stopping"
												? "statusStopping"
												: runtime.status === "error"
													? "statusError"
													: "statusStopped"
								]
							: t.clawAgentManagement.loadingAgentMd}
					</span>
					<span className="aw-session-count">
						{format(t.clawAgentManagement.agentCount, {
							count: view?.agents.length ?? 0,
						})}
					</span>
				</div>
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={() => void request({ type: "read" })}
				>
					{t.clawAgentManagement.refresh}
				</button>
			</header>
			{runtime && runtime.status !== "ready" && (
				<div className="aw-session-offline">
					<RuntimeIndicator runtime={runtime} request={request} />
				</div>
			)}
		</div>
	);
}

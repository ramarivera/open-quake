import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type {
	RuntimeConnectionView,
	RuntimeHealth,
} from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import type { AgentConnectionDiscovery } from "../../../../shared/agent-connections";
import type { AgentConversationsBridge } from "../../../../shared/agent-conversations";
import { parseRichText } from "../../strip/tiles/clawBot/rich-text";
import { Composer } from "../chat/Composer";
import { revealEnd } from "../chat/follow";
import { fill } from "../chat/format";
import { Icon } from "../chat/icons";
import { Prose } from "../chat/Prose";
import { ActionDialog } from "./ActionDialog";
import { healthLabel, healthTone } from "./health";
import t from "./strings.json";
import { useConversation } from "./useConversation";

/** A conversation with one saved Hermes or OpenClaw runtime connection. */
export function ConversationPanel({
	connection,
	discovery,
	health,
	agentId,
	bridge,
	selectionBusy,
	sources,
	onTest,
	onOpenConnection,
	onAgentChange,
	onRunningChange,
}: {
	readonly connection: RuntimeConnectionView;
	readonly discovery: AgentConnectionDiscovery | undefined;
	readonly health?: RuntimeHealth | undefined;
	readonly agentId: string | undefined;
	readonly bridge: AgentConversationsBridge | undefined;
	readonly selectionBusy: boolean;
	/** Source switcher rendered at the top of the rail. */
	readonly sources?: ReactNode;
	readonly onTest?: () => void;
	readonly onOpenConnection?: () => void;
	readonly onAgentChange: (agentId: string | undefined) => void;
	readonly onRunningChange: (running: boolean) => void;
}) {
	const [modelDraft, setModelDraft] = useState("");
	const models =
		connection.kind === "hermes" &&
		discovery?.capabilities.models === "supported"
			? (discovery.models ?? [])
			: [];
	const modelId = models.some((model) => model.id === modelDraft)
		? modelDraft
		: undefined;
	const conversation = useConversation(bridge, {
		connectionId: connection.id,
		...(agentId === undefined ? {} : { agentId }),
		...(modelId === undefined ? {} : { modelId }),
	});
	const [message, setMessage] = useState("");
	const [agentDraft, setAgentDraft] = useState(agentId ?? "");
	const [confirmClear, setConfirmClear] = useState(false);
	const [listOpen, setListOpen] = useState(false);
	const input = useRef<HTMLTextAreaElement>(null);
	const log = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const reveal = useRef(false);
	const shown = useRef<string | undefined>(undefined);
	const active = Boolean(conversation.active);
	const busy = active || conversation.pending !== undefined;
	const session = conversation.history.find(
		(item) => item.sessionId === conversation.sessionId,
	);
	const chat = discovery?.capabilities.chat ?? "unverified";
	const kind = connection.kind === "hermes" ? "Hermes" : "OpenClaw";
	const status = health?.status ?? "";
	useEffect(() => setAgentDraft(agentId ?? ""), [agentId]);
	useEffect(() => {
		onRunningChange(busy);
		return () => onRunningChange(false);
	}, [busy, onRunningChange]);
	const lastTurn = session?.turns.at(-1);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Follow new text only while the reader stays at the bottom.
	useLayoutEffect(() => {
		// Opening another conversation always lands on its newest message.
		const opened = shown.current !== conversation.sessionId;
		shown.current = conversation.sessionId;
		if (log.current)
			revealEnd(log.current, follow.current, reveal.current || opened);
		reveal.current = false;
	}, [
		lastTurn?.answer,
		lastTurn?.requestId,
		conversation.tools.length,
		conversation.sessionId,
	]);
	const open = (url: string) => {
		void window.quakeVoice?.request({ _tag: "OpenLink", url });
	};
	const send = () => {
		const sent = message;
		follow.current = true;
		reveal.current = true;
		void conversation.send(sent).then((accepted) => {
			if (accepted) setMessage((current) => (current === sent ? "" : current));
		});
	};
	const notice =
		chat === "supported"
			? undefined
			: chat === "unsupported"
				? t.chatUnsupported
				: t.chatUnverified;
	return (
		<section className="cw-view agent-http-view">
			<aside className="cw-rail">
				{sources}
				<div className="cw-sessions">
					<div className="cw-sessions-head">
						<h3 id="agent-http-history-label">{t.conversations}</h3>
						<button
							type="button"
							className="mc-button cw-list-toggle"
							data-variant="quiet"
							aria-expanded={listOpen}
							aria-controls="agent-http-history"
							onClick={() => setListOpen((value) => !value)}
						>
							{listOpen ? t.hideConversations : t.showConversations}
							{conversation.history.length > 0 && (
								<span className="cw-count">{conversation.history.length}</span>
							)}
						</button>
						<button
							type="button"
							className="mc-button"
							disabled={busy || !session}
							onClick={() => {
								setListOpen(false);
								conversation.selectSession(undefined);
								input.current?.focus();
							}}
						>
							<Icon name="plus" />
							{t.newSession}
						</button>
					</div>
					<nav
						id="agent-http-history"
						aria-labelledby="agent-http-history-label"
						className="agent-http-sessions cw-session-list"
						data-open={listOpen || undefined}
					>
						{conversation.history.length === 0 ? (
							<p className="cw-muted">
								{conversation.pending === "history"
									? t.historyLoading
									: t.noSessions}
							</p>
						) : (
							[...conversation.history].reverse().map((item) => (
								<button
									type="button"
									className="cw-session"
									key={item.sessionId}
									aria-current={
										item.sessionId === conversation.sessionId
											? "true"
											: undefined
									}
									disabled={busy}
									onClick={() => {
										setListOpen(false);
										conversation.selectSession(item.sessionId);
									}}
								>
									<span className="cw-session-title">
										{item.turns[0]?.text || t.newSession}
									</span>
									<span className="cw-session-meta">
										{item.turns.length === 1
											? t.messageCountOne
											: fill(t.messageCount, { count: item.turns.length })}
									</span>
								</button>
							))
						)}
					</nav>
					<button
						type="button"
						className="mc-button cw-refresh"
						data-variant="quiet"
						disabled={busy || !bridge}
						onClick={() => void conversation.refresh()}
					>
						<Icon name="refresh" />
						{t.refreshHistory}
					</button>
				</div>
			</aside>
			<section className="cw-main" aria-label={t.conversation}>
				<header className="cw-header">
					<div className="cw-header-title">
						<h2 className="cw-title">
							{session?.turns[0]?.text || t.newSession}
						</h2>
						<p className="cw-identity">
							<span className="mc-badge">{connection.name}</span>
							<span>{kind}</span>
							<code className="agent-http-address cw-code">
								{connection.baseURL}
							</code>
							<span className="cw-health">
								<span
									className="cw-dot"
									data-tone={healthTone(status)}
									aria-hidden="true"
								/>
								<span role="status">{healthLabel(status)}</span>
							</span>
							{onTest && (
								<button
									type="button"
									className="cw-inline-action"
									disabled={selectionBusy || busy}
									onClick={onTest}
								>
									{t.test}
								</button>
							)}
						</p>
						<div className="cw-route">
							{connection.kind === "hermes" ? (
								models.length > 0 ? (
									<label className="mc-field cw-route-field">
										<span>{t.modelAlias}</span>
										<select
											value={modelId ?? ""}
											disabled={busy || selectionBusy}
											title={t.modelAliasHint}
											onChange={(event) => setModelDraft(event.target.value)}
										>
											<option value="">{t.endpointDefault}</option>
											{models.map((model) => (
												<option key={model.id} value={model.id}>
													{model.name || model.id}
												</option>
											))}
										</select>
									</label>
								) : (
									<span className="cw-muted">{t.hermesAgent}</span>
								)
							) : discovery?.capabilities.listAgents === "supported" ? (
								<label className="mc-field cw-route-field">
									<span>{t.agent}</span>
									<select
										value={agentId ?? ""}
										disabled={busy || selectionBusy}
										onChange={(event) =>
											onAgentChange(event.target.value || undefined)
										}
									>
										<option value="">{t.endpointDefault}</option>
										{agentId &&
											!discovery.agents.some(
												(agent) => agent.id === agentId,
											) && <option value={agentId}>{agentId}</option>}
										{discovery.agents.map((agent) => (
											<option key={agent.id} value={agent.id}>
												{agent.name || agent.id}
											</option>
										))}
									</select>
									{discovery.agents.length === 0 && (
										<span className="cw-muted">{t.noAgents}</span>
									)}
								</label>
							) : (
								<form
									className="cw-route-form"
									onSubmit={(event) => {
										event.preventDefault();
										onAgentChange(agentDraft.trim() || undefined);
									}}
								>
									<label className="mc-field cw-route-field">
										<span>{t.agentId}</span>
										<input
											value={agentDraft}
											maxLength={256}
											disabled={busy || selectionBusy}
											placeholder={t.endpointDefault}
											title={t.agentIdHint}
											onChange={(event) => setAgentDraft(event.target.value)}
										/>
									</label>
									<button
										type="submit"
										className="mc-button"
										disabled={
											busy ||
											selectionBusy ||
											agentDraft.trim() === (agentId ?? "")
										}
									>
										{t.useAgent}
									</button>
								</form>
							)}
							<span className="cw-muted">{t.quakeHere}</span>
						</div>
					</div>
					<div className="cw-header-actions">
						{onOpenConnection && (
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								disabled={selectionBusy}
								onClick={onOpenConnection}
							>
								<Icon name="plug" />
								{t.connectionDetails}
							</button>
						)}
						<button
							type="button"
							className="mc-button"
							data-variant="quiet"
							title={t.clearHistoryHint}
							disabled={busy || !session}
							onClick={() => setConfirmClear(true)}
						>
							<Icon name="trash" />
							{t.clearHistory}
						</button>
					</div>
				</header>
				{conversation.error && (
					<div role="alert" className="cw-banner agent-http-error">
						<p>
							<strong>{conversation.error.message}</strong>{" "}
							<code className="cw-code">{conversation.error.code}</code>
						</p>
						<div className="cw-banner-actions">
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								onClick={conversation.dismissError}
							>
								{t.dismiss}
							</button>
						</div>
					</div>
				)}
				<div
					ref={log}
					className="agent-http-transcript cw-transcript"
					role="log"
					aria-label={t.transcript}
					aria-live="polite"
					aria-relevant="additions text"
					onScroll={() => {
						const el = log.current;
						if (el)
							follow.current =
								el.scrollHeight - el.scrollTop - el.clientHeight < 32;
					}}
				>
					{conversation.pending === "history" && !session ? (
						<p className="cw-muted" role="status">
							{t.historyLoading}
						</p>
					) : !session?.turns.length ? (
						<div className="cw-empty">
							<h3>{fill(t.emptyTitle, { name: connection.name })}</h3>
							<p>{t.emptyBody}</p>
						</div>
					) : (
						session.turns.map((turn) => {
							const last = turn === lastTurn;
							const live = turn.outcome === "processing";
							return (
								<div className="cw-turn" key={turn.requestId}>
									<article className="agent-http-message cw-user">
										<p className="visually-hidden">{t.you}</p>
										<p className="cw-bubble">{turn.text}</p>
									</article>
									<article className="agent-http-message cw-answer">
										<p className="cw-answer-label">{t.assistant}</p>
										{turn.answer ? (
											<Prose
												value={parseRichText(turn.answer)}
												onOpen={open}
												linkHint={t.openLink}
											/>
										) : (
											live && (
												<p className="cw-waiting">
													<span className="cw-pulse" aria-hidden="true" />
													{t.waiting}
												</p>
											)
										)}
										{last && conversation.tools.length > 0 && (
											<ul
												className="cw-tools agent-http-tools"
												aria-label={t.capabilityLabels.toolEvents}
											>
												{conversation.tools.map((tool) => (
													<li key={tool.toolCallId} data-phase={tool.phase}>
														<span
															className="cw-dot"
															data-tone={
																tool.phase === "completed"
																	? "success"
																	: tool.phase === "failed"
																		? "danger"
																		: "accent"
															}
															aria-hidden="true"
														/>
														<span>{tool.label || tool.tool}</span>
														<span className="cw-muted">
															{t.toolPhases[tool.phase]}
														</span>
													</li>
												))}
											</ul>
										)}
										<p className="cw-turn-meta" data-outcome={turn.outcome}>
											{live ? (
												<>
													<span className="cw-pulse" aria-hidden="true" />
													<span>
														{conversation.pending === "cancelling"
															? t.cancelling
															: conversation.status || t.waiting}
													</span>
												</>
											) : (
												<span>{t[turn.outcome]}</span>
											)}
											{last && conversation.usage && (
												<span>
													{conversation.usage.inputTokens} {t.inputTokens} ·{" "}
													{conversation.usage.outputTokens} {t.outputTokens} ·{" "}
													{t[conversation.usage.provenance]}
												</span>
											)}
										</p>
										{last && turn.outcome === "failed" && (
											<div className="cw-turn-error">
												<p>{t.failed}</p>
												<button
													type="button"
													className="mc-button"
													data-variant="quiet"
													disabled={busy}
													onClick={() => {
														setMessage(turn.text);
														input.current?.focus();
													}}
												>
													{t.reuse}
												</button>
											</div>
										)}
									</article>
								</div>
							);
						})
					)}
				</div>
				<p role="status" className="visually-hidden">
					{conversation.pending === "cancelling"
						? t.cancelling
						: conversation.status}
				</p>
				<Composer
					value={message}
					onChange={setMessage}
					onSubmit={send}
					onStop={() => void conversation.cancel()}
					canSend={
						Boolean(bridge) &&
						!busy &&
						chat === "supported" &&
						!selectionBusy &&
						Boolean(message.trim())
					}
					disabled={!bridge || busy || chat !== "supported" || selectionBusy}
					running={active}
					stopping={conversation.pending === "cancelling"}
					notice={notice}
					inputRef={input}
					copy={{
						label: t.message,
						placeholder: fill(t.messagePlaceholder, { name: connection.name }),
						hint: t.composerHint,
						send: [t.sendShort, t.sendSuffix],
						stop: [t.stopShort, t.stopSuffix],
						stopping: t.cancelling,
					}}
				/>
			</section>
			{confirmClear && (
				<ActionDialog
					title={t.clearHistoryTitle}
					body={t.clearHistoryHint}
					confirm={t.clearHistory}
					danger
					busy={conversation.pending === "clearing"}
					onClose={() => setConfirmClear(false)}
					onConfirm={async () => {
						await conversation.clear();
						setConfirmClear(false);
					}}
				/>
			)}
		</section>
	);
}

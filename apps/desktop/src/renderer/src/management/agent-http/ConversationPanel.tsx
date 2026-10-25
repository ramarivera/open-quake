import { useEffect, useState } from "react";
import type { RuntimeConnectionView } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import type { AgentConnectionDiscovery } from "../../../../shared/agent-connections";
import type { AgentConversationsBridge } from "../../../../shared/agent-conversations";
import { ActionDialog } from "./ActionDialog";
import t from "./strings.json";
import { useConversation } from "./useConversation";

export function ConversationPanel({
	connection,
	discovery,
	agentId,
	bridge,
	selectionBusy,
	onAgentChange,
	onRunningChange,
}: {
	readonly connection: RuntimeConnectionView;
	readonly discovery: AgentConnectionDiscovery | undefined;
	readonly agentId: string | undefined;
	readonly bridge: AgentConversationsBridge | undefined;
	readonly selectionBusy: boolean;
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
	const active = Boolean(conversation.active);
	const busy = active || conversation.pending !== undefined;
	const session = conversation.history.find(
		(item) => item.sessionId === conversation.sessionId,
	);
	const chat = discovery?.capabilities.chat ?? "unverified";
	useEffect(() => setAgentDraft(agentId ?? ""), [agentId]);
	useEffect(() => {
		onRunningChange(busy);
		return () => onRunningChange(false);
	}, [busy, onRunningChange]);
	return (
		<section className="mc-panel" aria-label={t.conversation}>
			<header className="mc-toolbar">
				<h2>{t.conversation}</h2>
				<span className="mc-badge">{connection.name}</span>
			</header>
			{connection.kind === "hermes" ? (
				<p className="agent-http-hint">{t.hermesAgent}</p>
			) : discovery?.capabilities.listAgents === "supported" ? (
				<label className="mc-field">
					{t.agent}
					<select
						value={agentId ?? ""}
						disabled={busy || selectionBusy}
						onChange={(event) => onAgentChange(event.target.value || undefined)}
					>
						<option value="">{t.endpointDefault}</option>
						{agentId &&
							!discovery.agents.some((agent) => agent.id === agentId) && (
								<option value={agentId}>{agentId}</option>
							)}
						{discovery.agents.map((agent) => (
							<option key={agent.id} value={agent.id}>
								{agent.name || agent.id}
							</option>
						))}
					</select>
					{discovery.agents.length === 0 && (
						<span className="agent-http-hint">{t.noAgents}</span>
					)}
				</label>
			) : (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						onAgentChange(agentDraft.trim() || undefined);
					}}
				>
					<label className="mc-field">
						{t.agentId}
						<input
							value={agentDraft}
							maxLength={256}
							disabled={busy || selectionBusy}
							placeholder={t.endpointDefault}
							onChange={(event) => setAgentDraft(event.target.value)}
						/>
						<span className="agent-http-hint">{t.agentIdHint}</span>
					</label>
					<button
						type="submit"
						className="mc-button"
						disabled={
							busy || selectionBusy || agentDraft.trim() === (agentId ?? "")
						}
					>
						{t.useAgent}
					</button>
				</form>
			)}
			{models.length > 0 && (
				<label className="mc-field">
					{t.modelAlias}
					<select
						value={modelId ?? ""}
						disabled={busy || selectionBusy}
						onChange={(event) => setModelDraft(event.target.value)}
					>
						<option value="">{t.endpointDefault}</option>
						{models.map((model) => (
							<option key={model.id} value={model.id}>
								{model.name || model.id}
							</option>
						))}
					</select>
					<span className="agent-http-hint">{t.modelAliasHint}</span>
				</label>
			)}
			<label className="mc-field">
				{t.session}
				<select
					value={conversation.sessionId ?? ""}
					disabled={busy}
					onChange={(event) =>
						conversation.selectSession(event.target.value || undefined)
					}
				>
					<option value="">{t.newSession}</option>
					{conversation.history.map((item) => (
						<option value={item.sessionId} key={item.sessionId}>
							{item.turns[0]?.text.slice(0, 70) || item.sessionId}
						</option>
					))}
				</select>
			</label>
			<div className="agent-http-actions">
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={() => conversation.selectSession(undefined)}
				>
					{t.newSession}
				</button>
				<button
					type="button"
					className="mc-button"
					disabled={busy || !bridge}
					onClick={() => void conversation.refresh()}
				>
					{t.refreshHistory}
				</button>
				<button
					type="button"
					className="mc-button"
					disabled={busy || !session}
					onClick={() => setConfirmClear(true)}
				>
					{t.clearHistory}
				</button>
			</div>
			<p className="agent-http-hint">{t.clearHistoryHint}</p>
			{conversation.error && (
				<div role="alert" className="agent-http-error">
					<p>
						{conversation.error.message} · {conversation.error.code}
					</p>
					<button
						type="button"
						className="mc-button"
						onClick={conversation.dismissError}
					>
						{t.dismiss}
					</button>
				</div>
			)}
			{chat !== "supported" && (
				<p role="status">
					{chat === "unsupported" ? t.chatUnsupported : t.chatUnverified}
				</p>
			)}
			<div
				className="agent-http-transcript"
				role="log"
				aria-label={t.conversation}
				aria-live="polite"
				aria-relevant="additions text"
			>
				{conversation.pending === "history" ? (
					<p role="status">{t.historyLoading}</p>
				) : !session?.turns.length ? (
					<p className="mc-empty">{t.historyEmpty}</p>
				) : (
					session.turns.map((turn) => (
						<div key={turn.requestId}>
							<article className="agent-http-message">
								<header>{t.you}</header>
								<p>{turn.text}</p>
							</article>
							<article className="agent-http-message">
								<header>{t.assistant}</header>
								<p>
									{turn.answer ||
										(turn.outcome === "processing"
											? t.waiting
											: t[turn.outcome])}
								</p>
								{turn.outcome !== "processing" &&
									turn.outcome !== "completed" &&
									turn.answer && (
										<p className="agent-http-hint">{t[turn.outcome]}</p>
									)}
							</article>
						</div>
					))
				)}
			</div>
			{conversation.tools.length > 0 && (
				<ul
					className="agent-http-tools"
					aria-label={t.capabilityLabels.toolEvents}
				>
					{conversation.tools.map((tool) => (
						<li key={tool.toolCallId}>
							{tool.label || tool.tool} · {t.toolPhases[tool.phase]}
						</li>
					))}
				</ul>
			)}
			{conversation.usage && (
				<p className="agent-http-hint">
					{conversation.usage.inputTokens} {t.inputTokens} ·{" "}
					{conversation.usage.outputTokens} {t.outputTokens} ·{" "}
					{t[conversation.usage.provenance]}
				</p>
			)}
			<p role="status" className="agent-http-hint">
				{conversation.pending === "cancelling"
					? t.cancelling
					: conversation.status}
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const sent = message;
					void conversation.send(sent).then((accepted) => {
						if (accepted)
							setMessage((current) => (current === sent ? "" : current));
					});
				}}
			>
				<label className="mc-field">
					{t.message}
					<textarea
						value={message}
						maxLength={32768}
						rows={4}
						placeholder={t.messagePlaceholder}
						disabled={!bridge || busy || chat !== "supported" || selectionBusy}
						onChange={(event) => setMessage(event.target.value)}
					/>
				</label>
				<div className="agent-http-actions">
					<button
						type="submit"
						className="mc-button"
						data-primary
						disabled={
							!bridge ||
							busy ||
							chat !== "supported" ||
							selectionBusy ||
							!message.trim()
						}
					>
						{t.send}
					</button>
					{active && (
						<button
							type="button"
							className="mc-button"
							disabled={conversation.pending === "cancelling"}
							onClick={() => void conversation.cancel()}
						>
							{conversation.pending === "cancelling" ? t.cancelling : t.stop}
						</button>
					)}
				</div>
			</form>
			{confirmClear && (
				<ActionDialog
					title={t.clearHistoryTitle}
					body={t.clearHistoryHint}
					confirm={t.clearHistory}
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

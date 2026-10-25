import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeConnectionView } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import type { AgentConnectionsBridge } from "../../../../shared/agent-connections";
import type { AgentConversationsBridge } from "../../../../shared/agent-conversations";
import { ActionDialog } from "./ActionDialog";
import { ConnectionForm } from "./ConnectionForm";
import { ConversationPanel } from "./ConversationPanel";
import type { ConnectionDraft } from "./connection-draft";
import t from "./strings.json";
import { useConnections } from "./useConnections";
import "./agent-http.css";

export interface AgentHttpPanelProps {
	readonly connectionsBridge?: AgentConnectionsBridge;
	readonly conversationsBridge?: AgentConversationsBridge;
}

export function AgentHttpPanel({
	connectionsBridge,
	conversationsBridge,
}: AgentHttpPanelProps) {
	const connections = useConnections(
		connectionsBridge ??
			(typeof window === "undefined"
				? undefined
				: window.quakeAgentConnections),
	);
	const conversationBridge =
		conversationsBridge ??
		(typeof window === "undefined"
			? undefined
			: window.quakeAgentConversations);
	const [editing, setEditing] = useState<{
		readonly connection: RuntimeConnectionView | undefined;
	}>();
	const [removing, setRemoving] = useState<RuntimeConnectionView>();
	const [running, setRunning] = useState(false);
	const [conversationRevision, setConversationRevision] = useState(0);
	const setConversationRunning = useCallback(
		(value: boolean) => setRunning(value),
		[],
	);
	const selected = connections.view?.connections.find(
		(item) => item.id === connections.view?.selected?.connectionId,
	);
	const discovery = selected ? connections.discovery[selected.id] : undefined;
	const health = selected ? connections.health[selected.id] : undefined;
	const busy = connections.busy || running;
	const request = connections.request;
	const selectedId = selected?.id;
	const discoveryKey = selectedId
		? `${selectedId}:${connections.view?.revision}`
		: undefined;
	const attemptedDiscovery = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!selectedId) attemptedDiscovery.current = undefined;
		else if (!connections.busy && discoveryKey !== attemptedDiscovery.current) {
			attemptedDiscovery.current = discoveryKey;
			void request({ type: "discover", id: selectedId });
		}
	}, [selectedId, discoveryKey, connections.busy, request]);
	const save = async (draft: ConnectionDraft): Promise<boolean> => {
		const existing = editing?.connection;
		const previousIds = new Set(
			connections.view?.connections.map((item) => item.id),
		);
		const reply = await request({
			type: "save",
			...(existing ? { id: existing.id } : {}),
			name: draft.name.trim(),
			kind: draft.kind,
			baseURL: draft.baseURL,
			...(draft.credential ? { credential: draft.credential } : {}),
			...(draft.clearCredential ? { clearCredential: true } : {}),
		});
		if (reply?._tag !== "success") return false;
		setEditing(undefined);
		if (
			existing &&
			(draft.kind !== existing.kind ||
				draft.baseURL !== existing.baseURL ||
				draft.credential ||
				draft.clearCredential)
		)
			setConversationRevision((revision) => revision + 1);
		const savedId =
			existing?.id ??
			reply.view.connections.find((item) => !previousIds.has(item.id))?.id;
		if (savedId && reply.view.selected?.connectionId !== savedId) {
			await request({ type: "select", id: savedId });
		}
		return true;
	};
	const healthLabel = health
		? {
				ready: t.ready,
				unavailable: t.unreachable,
				authenticationRequired: t.authenticationRequired,
				error: t.healthError,
			}[health.status]
		: t.notTested;
	return (
		<div className="agent-http">
			<header className="mc-toolbar">
				<div>
					<h2>{t.title}</h2>
					<p className="agent-http-hint">{t.subtitle}</p>
				</div>
				<button
					type="button"
					className="mc-button"
					disabled={busy || Boolean(editing)}
					onClick={() => setEditing({ connection: undefined })}
				>
					{t.add}
				</button>
			</header>
			{connections.error && (
				<div role="alert" className="agent-http-error">
					<p>
						{connections.error.message} · {connections.error.code}
					</p>
					<div className="agent-http-actions">
						<button
							type="button"
							className="mc-button"
							disabled={busy}
							onClick={() => void request({ type: "list" })}
						>
							{t.retry}
						</button>
						<button
							type="button"
							className="mc-button"
							onClick={connections.dismissError}
						>
							{t.dismiss}
						</button>
					</div>
				</div>
			)}
			{!connections.view && (
				<p role="status">{connections.busy ? t.loading : t.unavailable}</p>
			)}
			<div className="agent-http-layout">
				<section
					className="mc-panel"
					aria-label={t.connections}
					aria-busy={connections.busy}
				>
					<label className="mc-field">
						{t.connections}
						<select
							value={selected?.id ?? ""}
							disabled={busy || Boolean(editing)}
							onChange={(event) => {
								setEditing(undefined);
								void request({
									type: "select",
									...(event.target.value ? { id: event.target.value } : {}),
								});
							}}
						>
							<option value="">
								{connections.view?.connections.length
									? t.disconnect
									: t.chooseConnection}
							</option>
							{connections.view?.connections.map((item) => (
								<option key={item.id} value={item.id}>
									{item.name} · {item.kind === "hermes" ? "Hermes" : "OpenClaw"}
								</option>
							))}
						</select>
					</label>
					{selected ? (
						<>
							<div className="mc-toolbar">
								<span className="mc-badge" role="status">
									{healthLabel}
								</span>
								<span className="agent-http-hint">
									{selected.credentialAvailable
										? t.credentialSaved
										: t.noCredential}
								</span>
							</div>
							<code className="agent-http-address">{selected.baseURL}</code>
							<p className="agent-http-hint">{t.externallyManaged}</p>
							<div className="agent-http-actions">
								<button
									type="button"
									className="mc-button"
									disabled={busy || Boolean(editing)}
									onClick={() =>
										void request({ type: "test", id: selected.id })
									}
								>
									{t.test}
								</button>
								<button
									type="button"
									className="mc-button"
									disabled={busy || Boolean(editing)}
									onClick={() =>
										void request({ type: "discover", id: selected.id })
									}
								>
									{t.discover}
								</button>
								<button
									type="button"
									className="mc-button"
									disabled={busy || Boolean(editing)}
									onClick={() => setEditing({ connection: selected })}
								>
									{t.edit}
								</button>
								<button
									type="button"
									className="mc-button"
									disabled={busy || Boolean(editing)}
									onClick={() => setRemoving(selected)}
								>
									{t.remove}
								</button>
							</div>
							{discovery ? (
								<dl
									className="agent-http-capabilities"
									aria-label={t.capabilities}
								>
									{(
										Object.keys(t.capabilityLabels) as Array<
											keyof typeof t.capabilityLabels
										>
									).map((capability) => (
										<div key={capability}>
											<dt>{t.capabilityLabels[capability]}</dt>
											<dd>{t[discovery.capabilities[capability]]}</dd>
										</div>
									))}
								</dl>
							) : (
								<p className="agent-http-hint">{t.capabilitiesHint}</p>
							)}
						</>
					) : (
						<div>
							<h3>
								{connections.view?.connections.length
									? t.chooseConnection
									: t.noConnections}
							</h3>
							<p className="agent-http-hint">{t.noConnectionsHint}</p>
						</div>
					)}
					{editing && (
						<ConnectionForm
							key={editing.connection?.id ?? "new"}
							existing={editing.connection}
							busy={connections.busy}
							onSave={save}
							onCancel={() => setEditing(undefined)}
						/>
					)}
				</section>
				{selected ? (
					<ConversationPanel
						key={`${selected.id}:${selected.kind}:${selected.baseURL}:${connections.view?.selected?.agentId ?? ""}:${conversationRevision}`}
						connection={selected}
						discovery={discovery}
						agentId={
							selected.kind === "hermes"
								? undefined
								: connections.view?.selected?.agentId
						}
						bridge={conversationBridge}
						selectionBusy={connections.busy || Boolean(editing)}
						onAgentChange={(agentId) => {
							void request({
								type: "select",
								id: selected.id,
								...(agentId === undefined ? {} : { agentId }),
							});
						}}
						onRunningChange={setConversationRunning}
					/>
				) : (
					<section className="mc-panel mc-empty">
						<h3>{t.conversation}</h3>
						<p>{t.chooseRuntime}</p>
					</section>
				)}
			</div>
			{removing && (
				<ActionDialog
					title={t.removeTitle}
					body={t.removeBody}
					confirm={t.remove}
					busy={connections.busy}
					onClose={() => setRemoving(undefined)}
					onConfirm={async () => {
						const reply = await request({ type: "remove", id: removing.id });
						if (reply?._tag === "success") setRemoving(undefined);
					}}
				/>
			)}
		</div>
	);
}

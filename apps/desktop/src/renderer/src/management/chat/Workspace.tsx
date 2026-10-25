import { useCallback, useEffect, useRef, useState } from "react";
import type { RuntimeConnectionView } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import type { AgentConnectionsBridge } from "../../../../shared/agent-connections";
import type { AgentConversationsBridge } from "../../../../shared/agent-conversations";
import type { DirectChatBridge } from "../../../../shared/chat";
import { ActionDialog } from "../agent-http/ActionDialog";
import { ConnectionSheet } from "../agent-http/ConnectionSheet";
import { ConversationPanel } from "../agent-http/ConversationPanel";
import type { ConnectionDraft } from "../agent-http/connection-draft";
import { useRuntimeCopy } from "../agent-http/copy";
import { healthLabel, healthTone } from "../agent-http/health";
import { useConnections } from "../agent-http/useConnections";
import { chatStrings, DirectChatPanel } from "./DirectChatPanel";
import { Icon } from "./icons";
import type { DirectChatModel } from "./model-scope";

type Sheet =
	| { readonly mode: "add" }
	| { readonly mode: "details" | "edit"; readonly id: string };

/**
 * One conversation workspace for the direct model and saved Hermes/OpenClaw
 * runtimes. Opening a runtime selects it, which is also where QUAKE requests
 * go (unchanged host semantics); opening the direct model never changes it.
 */
export function ConversationWorkspace({
	model,
	configurationLoading = false,
	configurationError,
	onRetryConfiguration,
	locale = "en",
	onOpenSettings,
	chatBridge,
	connectionsBridge,
	conversationsBridge,
}: {
	readonly model: DirectChatModel;
	/** Model settings are still being read; readiness is not known yet. */
	readonly configurationLoading?: boolean;
	/** Model settings couldn't be read; distinct from "not configured". */
	readonly configurationError?: string | undefined;
	readonly onRetryConfiguration?: (() => void) | undefined;
	readonly locale?: string;
	readonly onOpenSettings?: () => void;
	readonly chatBridge?: DirectChatBridge;
	readonly connectionsBridge?: AgentConnectionsBridge;
	readonly conversationsBridge?: AgentConversationsBridge;
}) {
	const t = chatStrings(locale);
	const rt = useRuntimeCopy();
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
	const [source, setSource] = useState<string>("direct");
	const chosen = useRef(false);
	const [sheet, setSheet] = useState<Sheet>();
	const [removing, setRemoving] = useState<RuntimeConnectionView>();
	const [running, setRunning] = useState(false);
	const [revision, setRevision] = useState(0);
	const setConversationRunning = useCallback(
		(value: boolean) => setRunning(value),
		[],
	);
	const view = connections.view;
	const request = connections.request;
	const selectedId = view?.selected?.connectionId;
	const quakeRuntime = view?.connections.find((item) => item.id === selectedId);
	// Resume where QUAKE requests go, unless the user already picked a source.
	useEffect(() => {
		if (view && !chosen.current) {
			chosen.current = true;
			if (selectedId) setSource(selectedId);
		}
	}, [view, selectedId]);
	useEffect(() => {
		if (
			source !== "direct" &&
			view &&
			!view.connections.some((item) => item.id === source)
		)
			setSource("direct");
	}, [source, view]);
	const selected = source === selectedId ? quakeRuntime : undefined;
	const discovery = selected ? connections.discovery[selected.id] : undefined;
	const health = selected ? connections.health[selected.id] : undefined;
	const busy = connections.busy || running;
	const discoveryKey = selected ? `${selected.id}:${view?.revision}` : "";
	const attemptedDiscovery = useRef("");
	useEffect(() => {
		if (!selected) attemptedDiscovery.current = "";
		else if (!connections.busy && discoveryKey !== attemptedDiscovery.current) {
			attemptedDiscovery.current = discoveryKey;
			void request({ type: "discover", id: selected.id });
		}
	}, [selected, discoveryKey, connections.busy, request]);
	const openSource = (id: string) => {
		chosen.current = true;
		setSource(id);
		if (id !== "direct" && id !== selectedId)
			void request({ type: "select", id });
	};
	const editing =
		sheet && sheet.mode !== "add"
			? view?.connections.find((item) => item.id === sheet.id)
			: undefined;
	const save = async (draft: ConnectionDraft): Promise<boolean> => {
		const existing = sheet?.mode === "edit" ? editing : undefined;
		const reply = await connections.saveAndSelect({
			type: "save",
			...(existing ? { id: existing.id } : {}),
			name: draft.name.trim(),
			kind: draft.kind,
			baseURL: draft.baseURL,
			...(draft.credential ? { credential: draft.credential } : {}),
			...(draft.clearCredential ? { clearCredential: true } : {}),
		});
		if (reply?._tag !== "success") return false;
		setSheet(undefined);
		chosen.current = true;
		const savedId = reply.view.selected?.connectionId;
		if (savedId) setSource(savedId);
		if (
			existing &&
			(draft.kind !== existing.kind ||
				draft.baseURL !== existing.baseURL ||
				draft.credential ||
				draft.clearCredential)
		)
			setRevision((value) => value + 1);
		return true;
	};
	const sources = (
		<nav className="cw-sources" aria-label={t.sources}>
			<h3 className="cw-rail-heading">{t.sources}</h3>
			<ul>
				<li>
					<button
						type="button"
						className="cw-source"
						aria-current={source === "direct" ? "true" : undefined}
						disabled={running}
						onClick={() => openSource("direct")}
					>
						<span className="cw-source-name">{t.direct}</span>
						<span className="cw-source-meta">
							<span
								className="cw-dot"
								data-tone={
									configurationLoading
										? "neutral"
										: configurationError
											? "danger"
											: model.ready
												? "success"
												: "warning"
								}
								aria-hidden="true"
							/>
							{configurationLoading
								? t.loadingConfiguration
								: configurationError
									? t.configurationFailed
									: model.row
										? model.row.model
										: t.directNotSet}
						</span>
						{!selectedId && view && (
							<span className="mc-badge" data-tone="accent">
								{t.quakeBadge}
							</span>
						)}
					</button>
				</li>
				{view?.connections.map((item) => {
					const status = connections.health[item.id]?.status ?? "";
					return (
						<li key={item.id}>
							<button
								type="button"
								className="cw-source"
								aria-current={source === item.id ? "true" : undefined}
								disabled={busy}
								onClick={() => openSource(item.id)}
							>
								<span className="cw-source-name">{item.name}</span>
								<span className="cw-source-meta">
									<span
										className="cw-dot"
										data-tone={healthTone(status)}
										aria-hidden="true"
									/>
									{item.kind === "hermes" ? "Hermes" : "OpenClaw"} ·{" "}
									{healthLabel(status, rt)}
								</span>
								{item.id === selectedId && (
									<span className="mc-badge" data-tone="accent">
										{t.quakeBadge}
									</span>
								)}
							</button>
						</li>
					);
				})}
			</ul>
			{!view && (
				<p className="cw-muted" role="status">
					{connections.busy ? rt.loading : rt.unavailable}
				</p>
			)}
			<button
				type="button"
				className="mc-button cw-add"
				data-variant="quiet"
				disabled={busy || Boolean(sheet)}
				onClick={() => setSheet({ mode: "add" })}
			>
				<Icon name="plus" />
				{t.addConnection}
			</button>
		</nav>
	);
	const pendingRuntime =
		source !== "direct"
			? view?.connections.find((item) => item.id === source)
			: undefined;
	return (
		<div className="conversation-workspace agent-http">
			{connections.error && (
				<div className="cw-banner" role="alert">
					<p>
						<strong>{connections.error.message}</strong>{" "}
						<code className="cw-code">{connections.error.code}</code>
					</p>
					<div className="cw-banner-actions">
						<button
							type="button"
							className="mc-button"
							disabled={busy}
							onClick={() => void request({ type: "list" })}
						>
							{rt.retry}
						</button>
						<button
							type="button"
							className="mc-button"
							data-variant="quiet"
							onClick={connections.dismissError}
						>
							{rt.dismiss}
						</button>
					</div>
				</div>
			)}
			{source !== "direct" &&
				(selected ? (
					<ConversationPanel
						key={`${selected.id}:${selected.kind}:${selected.baseURL}:${view?.selected?.agentId ?? ""}:${revision}`}
						connection={selected}
						discovery={discovery}
						health={health}
						agentId={
							selected.kind === "hermes" ? undefined : view?.selected?.agentId
						}
						bridge={conversationBridge}
						selectionBusy={connections.busy || Boolean(sheet)}
						sources={sources}
						onTest={() => void request({ type: "test", id: selected.id })}
						onOpenConnection={() =>
							setSheet({ mode: "details", id: selected.id })
						}
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
					<section className="cw-view" aria-busy={connections.busy}>
						<aside className="cw-rail">{sources}</aside>
						<div className="cw-main">
							<div className="cw-empty">
								<h3>{pendingRuntime?.name ?? rt.chooseConnection}</h3>
								<p role="status">
									{connections.busy ? rt.busy : rt.chooseRuntime}
								</p>
								{pendingRuntime && !connections.busy && (
									<button
										type="button"
										className="mc-button"
										data-primary
										onClick={() =>
											void request({ type: "select", id: pendingRuntime.id })
										}
									>
										{rt.retry}
									</button>
								)}
							</div>
						</div>
					</section>
				))}
			{/* Stays mounted while hidden so switching sources never cancels a
			    streaming direct reply. It follows the runtime view in document
			    order so runtime selectors resolve to the visible conversation. */}
			<DirectChatPanel
				hidden={source !== "direct"}
				bridge={
					chatBridge ??
					(typeof window === "undefined" ? undefined : window.quakeChat)
				}
				model={model}
				configurationLoading={configurationLoading}
				configurationError={configurationError}
				onRetryConfiguration={onRetryConfiguration}
				locale={locale}
				sources={sources}
				quake={{
					runtime: quakeRuntime?.name,
					busy,
					useDirect: () => void request({ type: "select" }),
				}}
				{...(onOpenSettings ? { onOpenSettings } : {})}
			/>
			{sheet && (
				<ConnectionSheet
					mode={sheet.mode}
					connection={editing}
					health={editing ? connections.health[editing.id] : undefined}
					discovery={editing ? connections.discovery[editing.id] : undefined}
					busy={connections.busy}
					onSave={save}
					onEdit={() => editing && setSheet({ mode: "edit", id: editing.id })}
					onDiscover={() =>
						editing && void request({ type: "discover", id: editing.id })
					}
					onRemove={() => {
						if (editing) setRemoving(editing);
						setSheet(undefined);
					}}
					onClose={() => setSheet(undefined)}
				/>
			)}
			{removing && (
				<ActionDialog
					title={rt.removeTitle}
					body={rt.removeBody}
					confirm={rt.remove}
					danger
					busy={connections.busy}
					onClose={() => setRemoving(undefined)}
					onConfirm={async () => {
						const reply = await request({ type: "remove", id: removing.id });
						if (reply?._tag === "success") {
							setRemoving(undefined);
							if (source === removing.id) setSource("direct");
						}
					}}
				/>
			)}
		</div>
	);
}

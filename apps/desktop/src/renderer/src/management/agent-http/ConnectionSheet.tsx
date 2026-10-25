import type {
	RuntimeConnectionView,
	RuntimeHealth,
} from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import type { AgentConnectionDiscovery } from "../../../../shared/agent-connections";
import { AgentDialog } from "../agents/Dialog";
import { Icon } from "../chat/icons";
import { ConnectionForm } from "./ConnectionForm";
import type { ConnectionDraft } from "./connection-draft";
import { useRuntimeCopy } from "./copy";
import { healthLabel, healthTone } from "./health";

const capabilityTone = (value: string) =>
	value === "supported"
		? "success"
		: value === "unverified"
			? "warning"
			: "neutral";

/**
 * Connection details and editing in one dialog. Credentials are never shown;
 * only whether one is saved.
 */
export function ConnectionSheet({
	mode,
	connection,
	health,
	discovery,
	busy,
	onSave,
	onEdit,
	onDiscover,
	onRemove,
	onClose,
}: {
	readonly mode: "add" | "details" | "edit";
	readonly connection: RuntimeConnectionView | undefined;
	readonly health: RuntimeHealth | undefined;
	readonly discovery: AgentConnectionDiscovery | undefined;
	readonly busy: boolean;
	readonly onSave: (draft: ConnectionDraft) => Promise<boolean>;
	readonly onEdit: () => void;
	readonly onDiscover: () => void;
	readonly onRemove: () => void;
	readonly onClose: () => void;
}) {
	const t = useRuntimeCopy();
	if (mode === "add" || !connection)
		return (
			<AgentDialog title={t.addTitle} onClose={() => !busy && onClose()}>
				<p className="cw-muted">{t.addIntro}</p>
				<ConnectionForm
					key="new"
					existing={undefined}
					busy={busy}
					onSave={onSave}
					onCancel={onClose}
				/>
			</AgentDialog>
		);
	if (mode === "edit")
		return (
			<AgentDialog title={t.edit} onClose={() => !busy && onClose()}>
				<ConnectionForm
					key={connection.id}
					existing={connection}
					busy={busy}
					onSave={onSave}
					onCancel={onClose}
				/>
			</AgentDialog>
		);
	const status = health?.status ?? "";
	return (
		<AgentDialog title={connection.name} onClose={onClose}>
			<dl className="cw-facts">
				<div>
					<dt>{t.kind}</dt>
					<dd>{connection.kind === "hermes" ? "Hermes" : "OpenClaw"}</dd>
				</div>
				<div>
					<dt>{t.address}</dt>
					<dd>
						<code className="cw-code">{connection.baseURL}</code>
					</dd>
				</div>
				<div>
					<dt>{t.status}</dt>
					<dd>
						<span
							className="cw-dot"
							data-tone={healthTone(status)}
							aria-hidden="true"
						/>
						{healthLabel(status, t)}
					</dd>
				</div>
				<div>
					<dt>{t.credentialState}</dt>
					<dd>
						{connection.credentialAvailable
							? t.credentialSaved
							: t.noCredential}
					</dd>
				</div>
			</dl>
			<p className="cw-muted">{t.externallyManaged}</p>
			<section className="cw-capabilities" aria-label={t.capabilities}>
				<div className="cw-section-head">
					<h3>{t.capabilities}</h3>
					<button
						type="button"
						className="mc-button"
						data-variant="quiet"
						disabled={busy}
						onClick={onDiscover}
					>
						<Icon name="refresh" />
						{t.discover}
					</button>
				</div>
				{discovery ? (
					<dl className="agent-http-capabilities cw-capability-list">
						{(
							Object.keys(t.capabilityLabels) as Array<
								keyof typeof t.capabilityLabels
							>
						).map((capability) => (
							<div key={capability}>
								<dt>{t.capabilityLabels[capability]}</dt>
								<dd>
									<span
										className="cw-dot"
										data-tone={capabilityTone(
											discovery.capabilities[capability],
										)}
										aria-hidden="true"
									/>
									{t[discovery.capabilities[capability]]}
								</dd>
							</div>
						))}
					</dl>
				) : (
					<p className="cw-muted">{t.capabilitiesHint}</p>
				)}
			</section>
			<footer className="cw-dialog-actions">
				<button
					type="button"
					className="mc-button"
					data-variant="danger"
					disabled={busy}
					onClick={onRemove}
				>
					{t.remove}
				</button>
				<span className="cw-spacer" />
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={onEdit}
				>
					{t.edit}
				</button>
				<button
					type="button"
					className="mc-button"
					data-primary
					onClick={onClose}
				>
					{t.done}
				</button>
			</footer>
		</AgentDialog>
	);
}

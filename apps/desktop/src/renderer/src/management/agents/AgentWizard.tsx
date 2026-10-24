import { useState } from "react";
import {
	agentIdError,
	sanitizeAgentId,
} from "../../../../../../../packages/edge/src/agents/agents-invariants";
import {
	type Agent,
	type AgentView,
	EMOJI_PRESETS,
} from "../../../../shared/agents";
import { AgentDialog } from "./Dialog";
import strings from "./strings.json";
import type { AgentRequest } from "./useAgents";

const t = strings.clawAgentManagement;
export function AgentWizard({
	agent,
	view,
	request,
	onClose,
}: {
	readonly agent: Agent | undefined;
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly onClose: () => void;
}) {
	const [id, setId] = useState(agent?.id ?? "");
	const [name, setName] = useState(agent?.name ?? "");
	const [emoji, setEmoji] = useState(agent?.emoji ?? "🤖");
	const [created, setCreated] = useState(Boolean(agent));
	const [files, setFiles] = useState<Readonly<Record<string, string>>>(
		agent?.files ?? {},
	);
	const [active, setActive] = useState(
		Object.keys(agent?.files ?? {})[0] ?? "IDENTITY.md",
	);
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const invalid = created ? "" : agentIdError(id, view.agents);
	const validation =
		invalid === "reserved"
			? t.agentIdReservedError
			: invalid === "duplicate"
				? t.agentIdDuplicate
				: invalid === "format"
					? t.agentIdFormatError
					: "";
	const run = async (kind: "next" | "draft" | "save"): Promise<void> => {
		setBusy(true);
		setError("");
		try {
			const reply = await request(
				kind === "next"
					? { type: "create", id, name, emoji }
					: kind === "draft"
						? { type: "draft-agent", id, prompt, revision: view.revision }
						: {
								type: "save-file",
								id,
								file: active,
								content: files[active] ?? "",
								revision: view.revision,
							},
			);
			if (reply._tag === "rejected") {
				setError(`${reply.message} · ${reply.code}`);
				return;
			}
			if (kind === "save") {
				onClose();
				return;
			}
			const current = reply.view.agents.find((a) => a.id === id);
			if (current) {
				setCreated(true);
				setFiles(current.files);
				setActive(Object.keys(current.files)[0] ?? "IDENTITY.md");
			}
		} finally {
			setBusy(false);
		}
	};
	return (
		<AgentDialog
			title={agent ? t.editAgent : t.createAgent}
			onClose={() => {
				if (!busy) onClose();
			}}
		>
			{!agent && (
				<ol className="mc-tabs" aria-label={t.createAgent}>
					<li aria-current={!created ? "step" : undefined}>{t.wizardBasic}</li>
					<li aria-current={created ? "step" : undefined}>{t.wizardRole}</li>
				</ol>
			)}
			<form
				onSubmit={(event) => {
					event.preventDefault();
					void run(created ? "save" : "next");
				}}
			>
				{!created ? (
					<div className="mc-grid">
						<label className="mc-field">
							{t.agentId}
							<input
								value={id}
								maxLength={48}
								onChange={(event) => setId(sanitizeAgentId(event.target.value))}
								placeholder={t.agentIdPlaceholder}
								aria-invalid={Boolean(validation)}
								aria-describedby="agent-id-error"
								required
							/>
						</label>
						{validation && (
							<p id="agent-id-error" role="alert">
								{validation}
							</p>
						)}
						<label className="mc-field">
							{t.displayName}
							<input
								value={name}
								onChange={(event) => setName(event.target.value)}
								required
								maxLength={200}
							/>
						</label>
						<label className="mc-field">
							Emoji
							<select
								value={emoji}
								onChange={(event) => setEmoji(event.target.value)}
							>
								{EMOJI_PRESETS.map((value) => (
									<option key={value}>{value}</option>
								))}
							</select>
						</label>
						<p>{t.initWorkspaceHint}</p>
					</div>
				) : (
					<>
						<div className="mc-toolbar">
							<span className="mc-badge">
								{emoji} {name}
							</span>
							<code>{id}</code>
						</div>
						<label className="mc-field">
							{t.describeRole}
							<textarea
								rows={3}
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								placeholder={t.agentDescPromptPlaceholder}
							/>
						</label>
						<button
							type="button"
							className="mc-button"
							disabled={busy || !prompt.trim()}
							onClick={() => void run("draft")}
						>
							{busy ? t.generating : t.generateConfig}
						</button>
						{!view.draftingAvailable && (
							<p>AI drafting needs a configured provider.</p>
						)}
						<nav className="mc-tabs" aria-label="Workspace Markdown files">
							{Object.keys(files).map((file) => (
								<button
									key={file}
									type="button"
									className="mc-button"
									data-active={active === file}
									onClick={() => setActive(file)}
								>
									{file}
								</button>
							))}
						</nav>
						<label className="mc-field">
							{active}
							<textarea
								rows={14}
								value={files[active] ?? ""}
								onChange={(event) =>
									setFiles({ ...files, [active]: event.target.value })
								}
								spellCheck={false}
							/>
						</label>
					</>
				)}
				{error && <p role="alert">{error}</p>}
				<footer className="mc-toolbar">
					<button
						type="button"
						className="mc-button"
						disabled={busy}
						onClick={onClose}
					>
						{t.cancel}
					</button>
					<button
						type="submit"
						className="mc-button"
						disabled={busy || (!created && (Boolean(invalid) || !name.trim()))}
					>
						{busy ? t.saving : created ? t.saveAgent : t.wizardNext}
					</button>
				</footer>
			</form>
		</AgentDialog>
	);
}

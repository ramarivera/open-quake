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
import { saveWorkspaceFiles } from "./workspace-save";

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
	const [savedFiles, setSavedFiles] = useState(agent?.files ?? {});
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
			if (kind === "save") {
				const rejected = await saveWorkspaceFiles({
					id,
					files,
					saved: savedFiles,
					revision: view.revision,
					request,
					onSaved: (file, content) =>
						setSavedFiles((current) => ({ ...current, [file]: content })),
				});
				if (rejected) setError(`${rejected.message} · ${rejected.code}`);
				else onClose();
				return;
			}
			const reply = await request(
				kind === "next"
					? { type: "create", id, name, emoji }
					: { type: "draft-agent", id, prompt, revision: view.revision },
			);
			if (reply._tag === "rejected") {
				setError(`${reply.message} · ${reply.code}`);
				return;
			}
			const current = reply.view.agents.find((a) => a.id === id);
			if (current) {
				setCreated(true);
				setFiles(current.files);
				setSavedFiles(current.files);
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
				<ol className="aw-steps" aria-label={t.createAgent}>
					<li aria-current={!created ? "step" : undefined}>{t.wizardBasic}</li>
					<li aria-current={created ? "step" : undefined}>{t.wizardRole}</li>
				</ol>
			)}
			<form
				className="aw-form"
				onSubmit={(event) => {
					event.preventDefault();
					void run(created ? "save" : "next");
				}}
			>
				{!created ? (
					<div className="aw-form-grid">
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
							<p id="agent-id-error" role="alert" className="aw-field-error">
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
						<p className="cw-muted">{t.initWorkspaceHint}</p>
					</div>
				) : (
					<>
						<p className="aw-wizard-agent">
							<span aria-hidden="true">{emoji}</span> <strong>{name}</strong>{" "}
							<code className="cw-code">{id}</code>
						</p>
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
							<p className="cw-muted">{t.draftingUnavailable}</p>
						)}
						<nav className="aw-file-tabs" aria-label="Workspace Markdown files">
							{Object.keys(files).map((file) => (
								<button
									key={file}
									type="button"
									className="aw-file-tab"
									data-active={active === file}
									aria-current={active === file ? "true" : undefined}
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
								disabled={busy}
								value={files[active] ?? ""}
								onChange={(event) =>
									setFiles({ ...files, [active]: event.target.value })
								}
								spellCheck={false}
							/>
						</label>
					</>
				)}
				{error && (
					<p role="alert" className="cw-banner">
						{error}
					</p>
				)}
				<footer className="cw-dialog-actions">
					<span className="cw-spacer" />
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
						data-primary
						disabled={busy || (!created && (Boolean(invalid) || !name.trim()))}
					>
						{busy ? t.saving : created ? t.saveAgent : t.wizardNext}
					</button>
				</footer>
			</form>
		</AgentDialog>
	);
}

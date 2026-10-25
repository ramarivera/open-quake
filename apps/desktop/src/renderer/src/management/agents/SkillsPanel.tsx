import { useState } from "react";
import { skillFolderName } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import type { AgentView, Skill } from "../../../../shared/agents";
import { agentsStrings as strings } from "./copy";
import { AgentDialog, ConfirmDialog, format } from "./Dialog";
import type { AgentRequest } from "./useAgents";

const t = strings.clawAgentManagement;
function SkillEditor({
	skill,
	view,
	request,
	onClose,
}: {
	readonly skill: Skill | undefined;
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly onClose: () => void;
}) {
	const [name, setName] = useState(skill?.name ?? "");
	const [prompt, setPrompt] = useState("");
	const [content, setContent] = useState(
		skill?.content ?? "---\nname: \ndescription: \n---\n\n",
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const generate = async (): Promise<void> => {
		setBusy(true);
		const reply = await request({ type: "draft-skill", name, prompt });
		setBusy(false);
		if (reply._tag === "success") setContent(reply.draft);
		else
			setError(
				reply.code === "AGENT.SKILL.CONFLICT"
					? t.skillConflict
					: `${reply.message} · ${reply.code}`,
			);
	};
	return (
		<AgentDialog
			title={skill ? t.editSkill : t.createSkill}
			onClose={() => {
				if (!busy) onClose();
			}}
		>
			<form
				className="aw-form"
				onSubmit={(event) => {
					event.preventDefault();
					setBusy(true);
					void request({
						type: "save-skill",
						create: !skill,
						folder:
							skill?.folder ??
							skillFolderName(
								name,
								view.skills
									.filter((item) => item.owner === "")
									.map((item) => item.folder),
							),
						owner: skill?.owner ?? "",
						name,
						content,
						revision: view.revision,
					}).then((reply) => {
						setBusy(false);
						if (reply._tag === "success") onClose();
						else
							setError(
								reply.code === "AGENT.SKILL.CONFLICT"
									? t.skillConflict
									: `${reply.message} · ${reply.code}`,
							);
					});
				}}
			>
				<label className="mc-field">
					{t.name}
					<input
						value={name}
						required
						maxLength={80}
						onChange={(event) => {
							const next = event.target.value;
							setName(next);
							setContent((current) =>
								current.replace(/^name:.*$/m, `name: ${next}`),
							);
						}}
					/>
				</label>
				<label className="mc-field">
					{t.skillPromptLabel}
					<textarea
						rows={3}
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder={t.describeSkill}
					/>
				</label>
				<button
					type="button"
					className="mc-button"
					disabled={busy || !name.trim()}
					onClick={() => void generate()}
				>
					{busy ? t.generatingSkill : t.generateSkill}
				</button>
				{!view.draftingAvailable && (
					<p className="cw-muted">{t.draftingUnavailable}</p>
				)}
				<label className="mc-field">
					SKILL.md
					<textarea
						rows={18}
						value={content}
						onChange={(event) => setContent(event.target.value)}
						required
						spellCheck={false}
					/>
				</label>
				<p className="cw-muted">{t.skillSaveHint}</p>
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
						onClick={onClose}
						disabled={busy}
					>
						{t.cancel}
					</button>
					<button
						className="mc-button"
						type="submit"
						data-primary
						disabled={busy || !name.trim() || !content.trim()}
					>
						{t.saveSkill}
					</button>
				</footer>
			</form>
		</AgentDialog>
	);
}
export function SkillsPanel({
	view,
	request,
	busy,
}: {
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
}) {
	const [search, setSearch] = useState("");
	const [editing, setEditing] = useState<{
		readonly skill: Skill | undefined;
	}>();
	const [deleting, setDeleting] = useState<Skill>();
	const [equip, setEquip] = useState("");
	const [message, setMessage] = useState("");
	const visible = view.skills.filter((skill) =>
		[
			skill.name,
			skill.folder,
			skill.description,
			skill.owner,
			view.agents.find((a) => a.id === skill.owner)?.name ?? "",
		]
			.join(" ")
			.toLowerCase()
			.includes(search.toLowerCase()),
	);
	const move = async (skill: Skill, target: string): Promise<void> => {
		const reply = await request({
			type: "move-skill",
			folder: skill.folder,
			owner: skill.owner,
			target,
			revision: view.revision,
		});
		if (reply._tag === "success") {
			setEquip("");
			setMessage(
				target
					? format(t.equipSuccess, {
							skill: skill.name,
							agent: view.agents.find((a) => a.id === target)?.name ?? target,
						})
					: format(t.moveBackSuccess, { skill: skill.name }),
			);
		} else
			setMessage(
				reply.code === "AGENT.SKILL.CONFLICT"
					? t.skillConflict
					: reply.code === "AGENT.SKILL.WORKSPACE_INVALID"
						? t.invalidWorkspace
						: reply.code === "AGENT.SKILL.MOVED"
							? t.skillMoved
							: reply.code === "AGENT.SKILL.MOVE_INCOMPLETE"
								? t.skillMoveIncomplete
								: reply.message,
			);
	};
	return (
		<section className="mc-panel aw-skills" aria-label={t.skillManagementTab}>
			<header className="aw-section-head">
				<div>
					<h3>{t.allSkills}</h3>
					<p>{t.allSkillsHint}</p>
				</div>
				<button
					type="button"
					className="mc-button"
					data-primary
					onClick={() => setEditing({ skill: undefined })}
				>
					{t.createSkill}
				</button>
			</header>
			<div className="aw-list-tools">
				<label className="mc-field aw-search">
					<span className="visually-hidden">{t.searchSkills}</span>
					<input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={t.searchSkillPlaceholder}
					/>
				</label>
				<button
					type="button"
					className="mc-button"
					data-variant="quiet"
					disabled={busy}
					onClick={() => void request({ type: "read" })}
				>
					{t.refresh}
				</button>
			</div>
			{message && (
				<p role="status" className="aw-message">
					{message}
				</p>
			)}
			{visible.length === 0 ? (
				<div className="mc-empty">{t.noMatchingSkills}</div>
			) : (
				<ul className="aw-skill-list">
					{visible.map((skill) => {
						const owner = skill.owner
							? (view.agents.find((a) => a.id === skill.owner)?.name ??
								t.unknownAgent)
							: t.publicLibrary;
						return (
							<li key={`${skill.owner}/${skill.folder}`}>
								<div className="aw-skill-text">
									<p className="aw-row-title">
										{skill.name}{" "}
										<span
											className="mc-badge"
											data-tone={skill.owner ? "accent" : "neutral"}
										>
											{owner}
										</span>
									</p>
									<code className="aw-row-meta">{skill.folder}</code>
									<p className="cw-muted">
										{skill.description || t.noDescription}
									</p>
									{equip === skill.folder && (
										<fieldset className="aw-equip">
											<legend>{t.chooseTargetAgent}</legend>
											{view.agents
												.filter((a) => a.id !== "main")
												.map((a) => (
													<button
														type="button"
														className="mc-button"
														key={a.id}
														disabled={busy}
														onClick={() => void move(skill, a.id)}
													>
														{a.emoji} {a.name}
													</button>
												))}
											{view.agents.length < 2 && (
												<p className="cw-muted">{t.noEquipTarget}</p>
											)}
										</fieldset>
									)}
								</div>
								<div className="aw-row-actions">
									{!skill.owner ? (
										<button
											type="button"
											className="mc-button"
											disabled={busy}
											aria-expanded={equip === skill.folder}
											onClick={() =>
												setEquip(equip === skill.folder ? "" : skill.folder)
											}
										>
											{equip === skill.folder ? t.cancelEquip : t.equipToAgent}
										</button>
									) : (
										<button
											type="button"
											className="mc-button"
											disabled={busy}
											onClick={() => void move(skill, "")}
										>
											{t.moveBackToCommon}
										</button>
									)}
									<button
										type="button"
										className="mc-button"
										data-variant="quiet"
										onClick={() => setEditing({ skill })}
									>
										{t.edit}
									</button>
									<button
										type="button"
										className="mc-button"
										data-variant="quiet"
										onClick={() => setDeleting(skill)}
									>
										{t.delete}
									</button>
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{editing && (
				<SkillEditor
					skill={editing.skill}
					view={view}
					request={request}
					onClose={() => setEditing(undefined)}
				/>
			)}
			{deleting && (
				<ConfirmDialog
					title={t.delete}
					body={format(strings.clawSettings.deleteConfirm, {
						name: deleting.name,
					})}
					busy={busy}
					onClose={() => setDeleting(undefined)}
					onConfirm={async () => {
						const reply = await request({
							type: "delete-skill",
							folder: deleting.folder,
							owner: deleting.owner,
							confirmed: true,
							revision: view.revision,
						});
						if (reply._tag === "success") setDeleting(undefined);
					}}
				/>
			)}
		</section>
	);
}

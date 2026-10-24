import { useState } from "react";
import { skillFolderName } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import type { AgentView, Skill } from "../../../../shared/agents";
import { AgentDialog, ConfirmDialog, format } from "./Dialog";
import strings from "./strings.json";
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
					<p>AI drafting needs a configured provider.</p>
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
				<p>{t.skillSaveHint}</p>
				{error && <p role="alert">{error}</p>}
				<footer className="mc-toolbar">
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
		<section className="mc-panel" aria-label={t.skillManagementTab}>
			<header className="mc-toolbar">
				<div>
					<h2>{t.allSkills}</h2>
					<p>{t.allSkillsHint}</p>
				</div>
				<button
					type="button"
					className="mc-button"
					onClick={() => setEditing({ skill: undefined })}
				>
					{t.createSkill}
				</button>
			</header>
			<div className="mc-toolbar">
				<label className="mc-field">
					{t.searchSkills}
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
					disabled={busy}
					onClick={() => void request({ type: "read" })}
				>
					{t.refresh}
				</button>
			</div>
			{message && <p role="status">{message}</p>}
			{visible.length === 0 ? (
				<div className="mc-empty">{t.noMatchingSkills}</div>
			) : (
				visible.map((skill) => (
					<article className="mc-card" key={`${skill.owner}/${skill.folder}`}>
						<header className="mc-toolbar">
							<div>
								<h3>{skill.name}</h3>
								<code>{skill.folder}</code>
								<p>{skill.description || t.noDescription}</p>
							</div>
							<span className="mc-badge">
								{skill.owner
									? (view.agents.find((a) => a.id === skill.owner)?.name ??
										t.unknownAgent)
									: t.publicLibrary}
							</span>
						</header>
						<div className="mc-toolbar">
							{!skill.owner ? (
								<>
									<button
										type="button"
										className="mc-button"
										disabled={busy}
										onClick={() =>
											setEquip(equip === skill.folder ? "" : skill.folder)
										}
									>
										{equip === skill.folder ? t.cancelEquip : t.equipToAgent}
									</button>
									{equip === skill.folder && (
										<fieldset>
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
											{view.agents.length < 2 && <p>{t.noEquipTarget}</p>}
										</fieldset>
									)}
								</>
							) : (
								<>
									<span>
										{format(t.equippedTo, {
											agent:
												view.agents.find((a) => a.id === skill.owner)?.name ??
												skill.owner,
										})}
									</span>
									<button
										type="button"
										className="mc-button"
										disabled={busy}
										onClick={() => void move(skill, "")}
									>
										{t.moveBackToCommon}
									</button>
								</>
							)}
							<button
								type="button"
								className="mc-button"
								onClick={() => setEditing({ skill })}
							>
								{t.edit}
							</button>
							<button
								type="button"
								className="mc-button"
								onClick={() => setDeleting(skill)}
							>
								{t.delete}
							</button>
						</div>
					</article>
				))
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

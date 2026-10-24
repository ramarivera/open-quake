import { useCallback, useEffect, useRef, useState } from "react";
import { InputRejected } from "../../../../../../../packages/edge/src/channels/integration-errors";
import type {
	ShortcutLibrary,
	ShortcutRow,
} from "../../../../../../../packages/edge/src/shortcuts/shortcut-contracts";
import {
	conflictIds,
	displayChord,
	normalizeChord,
} from "../../../../../../../packages/edge/src/shortcuts/shortcut-invariants";
import { shortcutStrings as s, shortcutMessages } from "./strings";
import { useIntegrations } from "./useIntegrations";

const presets = [
	{
		app: "Adobe Photoshop",
		label: s.presetPsCropLabel,
		prompt: s.presetPsCropPrompt,
	},
	{
		app: "Adobe Illustrator",
		label: s.presetPsCurveLabel,
		prompt: s.presetPsCurvePrompt,
	},
	{ app: "Figma", label: s.presetPrCutLabel, prompt: s.presetPrCutPrompt },
	{
		app: "Adobe Premiere Pro",
		label: s.presetXlSortLabel,
		prompt: s.presetXlSortPrompt,
	},
	{
		app: "Microsoft Office",
		label: s.presetVsFormatLabel,
		prompt: s.presetVsFormatPrompt,
	},
];
const apps = [
	...presets.map((p) => p.app),
	"Microsoft Excel",
	"Visual Studio Code",
	s.customAppName,
];
export function ShortcutsPage() {
	const { request, error, busy, setError } = useIntegrations();
	const [app, setApp] = useState("Adobe Photoshop");
	const [custom, setCustom] = useState("");
	const [prompt, setPrompt] = useState("");
	const [aiAvailable, setAiAvailable] = useState(false);
	const [libraries, setLibraries] = useState<readonly ShortcutLibrary[]>([]);
	const [active, setActive] = useState("");
	const [rows, setRows] = useState<readonly ShortcutRow[]>([]);
	const [original, setOriginal] = useState<readonly ShortcutRow[]>([]);
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [title, setTitle] = useState("");
	const [editing, setEditing] = useState("");
	const [chord, setChord] = useState("");
	const [notice, setNotice] = useState("");
	const [rename, setRename] = useState<{ id: string; value: string } | null>(
		null,
	);
	const promptInput = useRef<HTMLInputElement>(null);
	const selectAll = useRef<HTMLInputElement>(null);
	const conflicts = conflictIds(rows);
	const application = app === s.customAppName ? custom : app;
	const activeLibrary = libraries.find((l) => l.id === active);
	const updateLibraries = useCallback(
		(next: readonly ShortcutLibrary[]) => setLibraries(next),
		[],
	);
	useEffect(() => {
		void request({ type: "shortcuts.list" }).then((reply) => {
			if (reply?.type === "libraries") {
				updateLibraries(reply.libraries);
				setAiAvailable(reply.aiAvailable);
			}
		});
	}, [request, updateLibraries]);
	useEffect(() => {
		if (selectAll.current)
			selectAll.current.indeterminate =
				selected.size > 0 && selected.size < rows.length;
	}, [selected, rows]);
	const load = (library: ShortcutLibrary) => {
		setActive(library.id);
		setRows(library.rows);
		setOriginal(library.rows);
		setTitle(library.name);
		setApp(apps.includes(library.app) ? library.app : s.customAppName);
		setCustom(library.app);
		setSelected(new Set());
		setEditing("");
	};
	const persist = async (next: readonly ShortcutRow[]) => {
		const previous = rows;
		setRows(next);
		if (!activeLibrary) return;
		const reply = await request({
			type: "shortcuts.save",
			library: { ...activeLibrary, rows: next },
		});
		if (reply?.type === "libraries") updateLibraries(reply.libraries);
		else setRows(previous);
	};
	const generate = async () => {
		if (!prompt.trim()) {
			setError(s.needPrompt);
			promptInput.current?.focus();
			return;
		}
		const reply = await request({
			type: "shortcuts.generate",
			app: application,
			prompt,
		});
		if (reply?.type !== "draft") return;
		setActive("");
		setTitle(reply.title);
		setRows(reply.rows);
		setOriginal(reply.rows);
		setSelected(new Set(reply.rows.slice(0, 3).map((r) => r.id)));
		setNotice(
			`${shortcutMessages.generated} ${reply.dropped} unsupported entries dropped`,
		);
	};
	const addManual = () => {
		const row = {
			id: crypto.randomUUID(),
			name: `Shortcut ${rows.length + 1}`,
			app: application,
			chord: "",
		};
		setActive("");
		setTitle("");
		setRows([...rows, row]);
		setOriginal([...original, row]);
		setSelected(new Set([...selected, row.id]));
	};
	const finishChord = (row: ShortcutRow) => {
		try {
			const normalized = normalizeChord(chord);
			setEditing("");
			void persist(
				rows.map((r) => (r.id === row.id ? { ...r, chord: normalized } : r)),
			);
		} catch (cause) {
			setError(
				cause instanceof InputRejected ? cause.field : "Invalid configuration",
			);
			setEditing("");
		}
	};
	return (
		<section className="mc-panel" aria-label={s.ariaLabel}>
			<header className="mc-toolbar">
				<div>
					<h2>{s.title}</h2>
					<p>{s.aiHint}</p>
				</div>
				<button
					className="mc-button"
					type="button"
					onClick={addManual}
					disabled={busy}
				>
					Add shortcut
				</button>
			</header>
			{error && <p role="alert">{error}</p>}
			{notice && <p role="status">{notice}</p>}
			<div className="mc-split">
				<main className="mc-panel">
					<section className="mc-card" aria-label={s.genTitle}>
						<h3>{s.genTitle}</h3>
						<fieldset className="mc-toolbar">
							<legend>{s.presetAria}</legend>
							{presets.map((p) => (
								<button
									className="mc-button"
									type="button"
									key={p.label}
									aria-pressed={app === p.app && prompt === p.prompt}
									title={p.prompt}
									onClick={() => {
										const clear = app === p.app && prompt === p.prompt;
										setApp(clear ? "" : p.app);
										setPrompt(clear ? "" : p.prompt);
										promptInput.current?.focus();
									}}
								>
									{p.label}
								</button>
							))}
						</fieldset>
						<form
							onSubmit={(event) => {
								event.preventDefault();
								void generate();
							}}
						>
							<div className="mc-toolbar">
								<label className="mc-field">
									{s.selectApp}
									<select
										aria-label={s.selectApp}
										value={app}
										onChange={(event) => setApp(event.target.value)}
									>
										<option value="" disabled>
											{s.selectApp}
										</option>
										{apps.map((name) => (
											<option key={name}>{name}</option>
										))}
									</select>
								</label>
								{app === s.customAppName && (
									<label className="mc-field">
										{s.customAppName}
										<input
											value={custom}
											maxLength={100}
											onChange={(event) => setCustom(event.target.value)}
										/>
									</label>
								)}
							</div>
							<label className="mc-field">
								{s.descPrompt}
								<input
									ref={promptInput}
									value={prompt}
									maxLength={180}
									placeholder={s.promptPlaceholder}
									onChange={(event) => setPrompt(event.target.value)}
								/>
							</label>
							<div className="mc-toolbar">
								<span>{prompt.length}/180</span>
								<button
									className="mc-button"
									data-primary
									type="submit"
									disabled={busy || !aiAvailable}
								>
									{busy ? s.generating : s.generate}
								</button>
							</div>
						</form>
						{!aiAvailable && (
							<p role="status">{shortcutMessages.unavailable}</p>
						)}
					</section>
					<section className="mc-card" aria-label={s.results}>
						<div className="mc-toolbar">
							<h3>
								{s.results} · {rows.length}
							</h3>
							<button
								className="mc-button"
								type="button"
								disabled={busy}
								onClick={addManual}
							>
								Add shortcut
							</button>
						</div>
						{!rows.length ? (
							<div className="mc-empty">
								<h4>{s.describeTask}</h4>
								<p>{s.emptyHint}</p>
								<button
									className="mc-button"
									type="button"
									onClick={() => promptInput.current?.focus()}
								>
									{s.startDescribe}
								</button>
							</div>
						) : (
							<div style={{ overflowX: "auto" }}>
								<table className="mc-table" aria-label={s.tableAria}>
									<thead>
										<tr>
											<th>
												<input
													ref={selectAll}
													type="checkbox"
													aria-label={s.selectAllAria}
													checked={
														selected.size === rows.length && rows.length > 0
													}
													onChange={(event) =>
														setSelected(
															new Set(
																event.target.checked
																	? rows.map((r) => r.id)
																	: [],
															),
														)
													}
												/>
											</th>
											<th>{s.colName}</th>
											<th>{s.colApp}</th>
											<th>{s.colShortcut}</th>
											<th>{s.colStatus}</th>
											<th>{s.reset}</th>
										</tr>
									</thead>
									<tbody>
										{rows.map((row) => {
											const saved = !!activeLibrary;
											const status = conflicts.has(row.id)
												? s.statusConflict
												: editing === row.id || !saved
													? s.statusUnsaved
													: s.statusSaved;
											return (
												<tr key={row.id}>
													<td>
														<input
															type="checkbox"
															aria-label={s.selectRowAria.replace(
																"{name}",
																row.name,
															)}
															checked={selected.has(row.id)}
															onChange={(event) =>
																setSelected(
																	new Set(
																		event.target.checked
																			? [...selected, row.id]
																			: [...selected].filter(
																					(id) => id !== row.id,
																				),
																	),
																)
															}
														/>
													</td>
													<td>
														<input
															aria-label={`Name for ${row.name}`}
															defaultValue={row.name}
															key={`${row.id}-${row.name}`}
															disabled={busy}
															maxLength={100}
															onBlur={(event) => {
																if (event.target.value !== row.name)
																	void persist(
																		rows.map((r) =>
																			r.id === row.id
																				? {
																						...r,
																						name:
																							event.target.value.trim() ||
																							`Shortcut ${rows.indexOf(row) + 1}`,
																					}
																				: r,
																		),
																	);
															}}
														/>
													</td>
													<td>{row.app}</td>
													<td>
														{editing === row.id ? (
															<input
																aria-label={s.editRowAria.replace(
																	"{name}",
																	row.name,
																)}
																value={chord}
																ref={(element) => {
																	element?.focus();
																}}
																onChange={(event) =>
																	setChord(event.target.value)
																}
																onBlur={() => finishChord(row)}
																onKeyDown={(event) => {
																	if (event.key === "Enter") {
																		event.preventDefault();
																		event.currentTarget.blur();
																	}
																	if (event.key === "Escape") setEditing("");
																}}
															/>
														) : (
															<button
																className="mc-button"
																type="button"
																disabled={busy}
																aria-label={s.editRowAria.replace(
																	"{name}",
																	row.name,
																)}
																onClick={() => {
																	setEditing(row.id);
																	setChord(displayChord(row.chord).join(" + "));
																}}
															>
																{row.chord
																	? displayChord(row.chord).map(
																			(part, index) => (
																				<span key={part}>
																					<kbd>{part}</kbd>
																					{index <
																					displayChord(row.chord).length - 1
																						? " + "
																						: ""}
																				</span>
																			),
																		)
																	: s.unset}
															</button>
														)}
													</td>
													<td>
														<span className="mc-badge">{status}</span>
													</td>
													<td>
														<button
															className="mc-button"
															type="button"
															disabled={busy}
															aria-label={s.resetAria.replace(
																"{name}",
																row.name,
															)}
															onClick={() => {
																const initial = original.find(
																	(r) => r.id === row.id,
																);
																if (initial)
																	void persist(
																		rows.map((r) =>
																			r.id === row.id ? initial : r,
																		),
																	);
															}}
														>
															{s.reset}
														</button>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
						<footer className="mc-toolbar">
							<span>
								{s.selectedCount.replace("{count}", String(selected.size))}
							</span>
							<button
								className="mc-button"
								type="button"
								onClick={() => setSelected(new Set())}
							>
								{s.clearSelection}
							</button>
							<button
								className="mc-button"
								type="button"
								disabled={!selected.size || busy}
								onClick={() => {
									if (
										window.confirm(
											s.confirmDeleteSelected.replace(
												"{count}",
												String(selected.size),
											),
										)
									) {
										void persist(rows.filter((r) => !selected.has(r.id)));
										setSelected(new Set());
									}
								}}
							>
								{s.deleteSelected}
							</button>
						</footer>
						<div className="mc-toolbar">
							<label className="mc-field">
								Shortcut pack name
								<input
									value={title}
									maxLength={100}
									onChange={(event) => setTitle(event.target.value)}
								/>
							</label>
							<button
								className="mc-button"
								data-primary
								type="button"
								disabled={!selected.size || busy}
								onClick={async () => {
									const library: ShortcutLibrary = {
										id: activeLibrary?.id ?? "",
										name:
											title || s.defaultPackName.replace("{name}", application),
										app: application,
										createdAt: activeLibrary?.createdAt ?? "",
										rows: rows.filter((r) => selected.has(r.id)),
									};
									const reply = await request({
										type: "shortcuts.save",
										library,
									});
									if (reply?.type === "libraries") {
										updateLibraries(reply.libraries);
										const saved = activeLibrary
											? reply.libraries.find(
													(item) => item.id === activeLibrary.id,
												)
											: reply.libraries.at(-1);
										if (saved) load(saved);
									}
								}}
							>
								{s.generateLibrary}
							</button>
						</div>
					</section>
				</main>
				<aside className="mc-aside" aria-label={s.libraryAria}>
					<div className="mc-toolbar">
						<h3>{s.libraryTitle}</h3>
						<button
							className="mc-button"
							type="button"
							disabled={busy}
							onClick={() => {
								setActive("");
								setRows([]);
								setOriginal([]);
								setSelected(new Set());
								setTitle("");
							}}
						>
							{s.addLibrary}
						</button>
					</div>
					{!libraries.length && (
						<div className="mc-empty">
							<h4>{s.emptyLibraryTitle}</h4>
							<p>{s.createHint}</p>
						</div>
					)}
					{libraries.map((library) => (
						<article className="mc-card" key={library.id}>
							<button
								className="mc-button"
								type="button"
								aria-pressed={active === library.id}
								disabled={busy}
								onClick={() => load(library)}
							>
								<span aria-hidden="true">
									{library.app.toLowerCase().includes("premiere")
										? "🎬"
										: library.app.toLowerCase().includes("office")
											? "▦"
											: "⌘"}
								</span>{" "}
								{library.name}
							</button>
							<p>{library.app}</p>
							<p>
								{s.libraryCount.replace("{count}", String(library.rows.length))}{" "}
								· {library.createdAt.slice(0, 10)}
							</p>

							{rename?.id === library.id && (
								<form
									onSubmit={async (event) => {
										event.preventDefault();
										const reply = await request({
											type: "shortcuts.save",
											library: { ...library, name: rename.value },
										});
										if (reply?.type === "libraries") {
											updateLibraries(reply.libraries);
											if (active === library.id) setTitle(rename.value);
											setRename(null);
										}
									}}
								>
									<label className="mc-field">
										{s.rename}
										<input
											value={rename.value}
											maxLength={100}
											onChange={(event) =>
												setRename({ id: library.id, value: event.target.value })
											}
										/>
									</label>
									<div className="mc-toolbar">
										<button className="mc-button" type="submit" disabled={busy}>
											Save
										</button>
										<button
											className="mc-button"
											type="button"
											onClick={() => setRename(null)}
										>
											Cancel
										</button>
									</div>
								</form>
							)}
							<div className="mc-toolbar">
								<button
									className="mc-button"
									type="button"
									disabled={busy}
									aria-label={s.renameLibraryAria.replace(
										"{name}",
										library.name,
									)}
									onClick={() =>
										setRename({ id: library.id, value: library.name })
									}
								>
									{s.rename}
								</button>
								<button
									className="mc-button"
									type="button"
									disabled={busy}
									onClick={async () => {
										if (
											!window.confirm(
												shortcutMessages.deleteConfirm.replace(
													"{name}",
													library.name,
												),
											)
										)
											return;
										const reply = await request({
											type: "shortcuts.remove",
											id: library.id,
										});
										if (reply?.type === "libraries") {
											updateLibraries(reply.libraries);
											if (active === library.id) {
												setActive("");
												setRows([]);
											}
										}
									}}
								>
									{s.delete}
								</button>
							</div>
						</article>
					))}
					<button
						className="mc-button"
						data-primary
						type="button"
						disabled={!activeLibrary || busy}
						onClick={async () => {
							if (!activeLibrary) return;
							const reply = await request({
								type: "shortcuts.sync",
								id: activeLibrary.id,
							});
							if (reply?.type === "ok") setNotice(shortcutMessages.synced);
						}}
					>
						{s.syncLabel}
					</button>
					<p>{s.syncHint}</p>
				</aside>
			</div>
		</section>
	);
}

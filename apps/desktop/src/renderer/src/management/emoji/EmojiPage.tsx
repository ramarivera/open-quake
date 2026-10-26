import { useCallback, useEffect, useRef, useState } from "react";
import {
	defaultCaption,
	type EmojiApp,
	type EmojiCaption,
	type EmojiItem,
	type EmojiMode,
} from "../../../../../../../packages/edge/src/emoji/emoji-contracts";
import { weightedLength } from "../../../../../../../packages/edge/src/emoji/emoji-invariants";
import type { EmojiReply, EmojiRequest } from "../../../../shared/emoji";
import { useAppLocale } from "../../i18n";
import { PageHeader } from "../../ui/Form";
import { captionGif, stillImageGif } from "./caption";
import { defaultMotion, motionPresets, utf8Length } from "./composer";
import { EmojiImage, useEmojiAsset } from "./EmojiImage";
import "./emoji.css";

type Ready = Extract<EmojiReply, { _tag: "ready" }>;
const swatches = [
	"ffffff",
	"000000",
	"ef4444",
	"f97316",
	"f59e0b",
	"eab308",
	"84cc16",
	"22c55e",
	"10b981",
	"14b8a6",
	"06b6d4",
	"3b82f6",
	"6366f1",
	"a855f7",
	"ec4899",
	"f472b6",
];
const base64 = (bytes: Uint8Array): string => {
	let text = "";
	for (const value of bytes) text += String.fromCharCode(value);
	return btoa(text);
};
const bytesOf = (url: string): Uint8Array =>
	Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (value) =>
		value.charCodeAt(0),
	);
export function EmojiPage(): React.JSX.Element {
	const { locale } = useAppLocale();
	const promptTouched = useRef(false);
	const suggestionVersion = useRef(0);
	const renameCancelled = useRef(false);
	const generationVersion = useRef(0);
	const [legacy, setLegacy] = useState(false);
	const [legacyPrompt, setLegacyPrompt] = useState("");
	const [suggestion, setSuggestion] = useState("");
	const [view, setView] = useState<Ready>();
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [packId, setPackId] = useState("");
	const [staticHash, setStaticHash] = useState("");
	const [title, setTitle] = useState("");
	const [caption, setCaption] = useState("");
	const [prompt, setPrompt] = useState(defaultMotion(locale));
	useEffect(() => {
		if (!promptTouched.current) setPrompt(defaultMotion(locale));
	}, [locale]);
	const [selected, setSelected] = useState<readonly string[]>([]);
	const [rename, setRename] = useState<{ id: string; name: string } | null>(
		null,
	);
	const [editing, setEditing] = useState<EmojiItem | null>(null);
	const [settings, setSettings] = useState(false);
	const [needsPack, setNeedsPack] = useState(false);
	const [remove, setRemove] = useState<{
		kind: "pack" | "emoji";
		id: string;
		name: string;
	} | null>(null);
	const staticSource = useEmojiAsset(staticHash);
	const editingSource = useEmojiAsset(editing?.original ?? "");
	const mounted = useRef(true);
	const viewDrafts = useRef<readonly string[]>([]);
	const run = useCallback(
		async (input: EmojiRequest): Promise<Ready | undefined> => {
			const bridge = window.quakeEmoji;
			if (!bridge) {
				setMessage("Emoji library is unavailable in this window.");
				return;
			}
			setBusy(true);
			const version = suggestionVersion.current;
			const generation = generationVersion.current;
			try {
				let reply = await bridge.request(input);
				if (reply._tag === "caption-suggestion") {
					if (mounted.current && version === suggestionVersion.current)
						setSuggestion(reply.text);
					return;
				}
				if (reply._tag === "generated") {
					const original = bytesOf(`data:image/gif;base64,${reply.base64}`);
					const rendered = await captionGif(original, reply.caption);
					if (!mounted.current || generation !== generationVersion.current)
						return;
					reply = await bridge.request({
						type: "create-result",
						name: reply.name,
						base64: reply.base64,
						renderedBase64: base64(rendered),
						caption: reply.caption,
					});
				}
				if (!mounted.current) return;
				if (reply._tag !== "ready") {
					if (reply._tag !== "failure")
						throw Error("Unexpected generated reply");
					setMessage(`${reply.message} (${reply.code})`);
					return;
				}
				const added = reply.store.drafts.filter(
					(id) => !viewDrafts.current.includes(id),
				);
				setSelected((ids) => [
					...new Set([
						...ids.filter((id) => reply.store.drafts.includes(id)),
						...added,
					]),
				]);
				viewDrafts.current = reply.store.drafts;
				setView(reply);
				setMessage(reply.notice);
				setPackId((id) =>
					reply.store.packages.some((p) => p.id === id)
						? id
						: (reply.store.packages[0]?.id ?? ""),
				);
				setStaticHash((hash) =>
					reply.store.staticAssets.some((a) => a.hash === hash)
						? hash
						: (reply.store.staticAssets[0]?.hash ?? ""),
				);
				return reply;
			} catch {
				setMessage("The emoji library did not respond. Try again.");
			} finally {
				if (mounted.current) setBusy(false);
			}
		},
		[],
	);
	useEffect(() => {
		mounted.current = true;
		void run({ type: "read" });
		return () => {
			mounted.current = false;
		};
	}, [run]);
	const pack = view?.store.packages.find((p) => p.id === packId);
	const staticAsset = view?.store.staticAssets.find(
		(a) => a.hash === staticHash,
	);
	const create = async (): Promise<void> => {
		const id = crypto.randomUUID();
		const reply = await run({
			type: "command",
			command: { type: "create-package", id, name: "Unnamed Pack" },
		});
		if (reply) {
			setPackId(id);
			renameCancelled.current = false;
			setRename({ id, name: "Unnamed Pack" });
		}
	};
	const edit = (item: EmojiItem): void => {
		suggestionVersion.current++;
		setSuggestion("");
		setEditing(item);
	};
	const saveName = (): void => {
		if (renameCancelled.current) return;
		if (rename) {
			renameCancelled.current = true;
			void run({
				type: "command",
				command: { type: "rename-package", ...rename },
			});
			setRename(null);
		}
	};
	const importGif = async (): Promise<void> => {
		const previous = view?.store.drafts ?? [];
		const next = await run({ type: "import-gif" });
		if (next)
			setSelected(next.store.drafts.filter((id) => !previous.includes(id)));
	};
	const makeStill = async (): Promise<void> => {
		const url = staticSource;
		if (!url) return;
		setBusy(true);
		try {
			const bytes = await stillImageGif(url);
			const initialCaption = { ...defaultCaption, text: caption };
			const rendered = await captionGif(bytes, initialCaption);
			const next = await run({
				type: "create-result",
				name: title || staticAsset?.name.slice(0, 30) || "Emoji",
				base64: base64(bytes),
				renderedBase64: base64(rendered),
				caption: initialCaption,
			});
			if (next?.store.drafts[0]) setSelected([next.store.drafts[0]]);
		} catch {
			setMessage("The image could not be rendered. Choose a valid PNG or JPG.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="page emoji-page">
			<PageHeader
				title="AI Emoji"
				description="Turn one image into your own animated Emoji"
			>
				<button
					className="mc-button"
					type="button"
					onClick={() => setSettings(true)}
				>
					App Match Settings
				</button>
			</PageHeader>
			<ol className="emoji-steps" aria-label="Emoji creation steps">
				<li>
					<span>1</span>Add Static Asset
				</li>
				<li>
					<span>2</span>Generate Motion Emoji
				</li>
				<li>
					<span>3</span>Compose Pack
				</li>
			</ol>
			<div className="mc-split emoji-workspace">
				<div className="emoji-creation">
					<section className="mc-panel">
						<div className="mc-toolbar">
							<h2>Static Assets ({view?.store.staticAssets.length ?? 0})</h2>
							{staticHash ? (
								<button
									className="mc-button"
									type="button"
									disabled={busy}
									onClick={() =>
										void run({
											type: "command",
											command: { type: "delete-static", hash: staticHash },
										})
									}
								>
									Delete selected
								</button>
							) : null}
							<button
								className="mc-button"
								disabled={busy}
								type="button"
								onClick={() => void run({ type: "import-static" })}
							>
								Add Asset
							</button>
						</div>
						{view?.store.staticAssets.length ? (
							<div
								className="emoji-assets"
								onWheel={(event) => {
									if (
										event.currentTarget.scrollWidth >
										event.currentTarget.clientWidth
									)
										event.currentTarget.scrollLeft += event.deltaY;
								}}
								role="listbox"
								aria-label="Static Emoji assets"
							>
								{view.store.staticAssets.map((asset) => (
									<button
										role="option"
										aria-selected={staticHash === asset.hash}
										title={asset.name}
										className="emoji-thumb"
										type="button"
										key={asset.hash}
										onClick={() => setStaticHash(asset.hash)}
									>
										<EmojiImage hash={asset.hash} alt={asset.name} />
									</button>
								))}
							</div>
						) : (
							<button
								className="emoji-import"
								type="button"
								disabled={busy}
								onClick={() => void run({ type: "import-static" })}
							>
								<span>＋</span>
								<strong>Add your first static Emoji</strong>
								<small>PNG, JPG supported. Select multiple at once.</small>
							</button>
						)}
					</section>
					<section className="mc-panel">
						<div className="mc-toolbar">
							<h2>Bring this image to life</h2>
							<small className="muted">
								{staticAsset?.name ?? "No asset selected"}
							</small>
						</div>
						<div className="emoji-composer">
							<div className="emoji-original">
								{staticSource ? (
									<img src={staticSource} alt="Original" />
								) : (
									<span>Add an image first</span>
								)}
								<small>Original</small>
							</div>
							<div>
								<div className="emoji-fields">
									<label className="mc-field">
										Emoji Name (Optional)
										<input
											value={title}
											maxLength={30}
											placeholder="e.g. Wave happily"
											onChange={(e) => setTitle(e.target.value)}
										/>
										<small>{title.length}/30</small>
									</label>
									<label className="mc-field">
										Caption Text (Optional)
										<input
											value={caption}
											placeholder="e.g. Go for it!"
											onChange={(e) => {
												if (weightedLength(e.target.value) <= 50)
													setCaption(e.target.value);
											}}
										/>
										<small>{weightedLength(caption)}/50</small>
									</label>
								</div>
								<label className="mc-field">
									Motion Description (Required)
									<textarea
										value={prompt}
										maxLength={180}
										placeholder="Describe what motion or emotion you want the character to perform…"
										onChange={(e) => {
											promptTouched.current = true;
											setPrompt(e.target.value);
										}}
									/>
									<small>{prompt.length}/180</small>
								</label>
								<p className="emoji-preset-label">
									Quick Actions (click to fill the description)
								</p>
								<div className="emoji-presets">
									{motionPresets(locale).map((text) => (
										<button
											className="mc-button"
											key={text}
											type="button"
											onClick={() => {
												promptTouched.current = true;
												setPrompt(text);
											}}
										>
											{text}
										</button>
									))}
								</div>
								<div className="emoji-actions">
									<button
										className="mc-button"
										type="button"
										disabled={busy}
										onClick={() => setLegacy(true)}
									>
										Generate from template
									</button>
									<button
										className="mc-button"
										data-primary
										disabled={busy || !staticHash || !prompt.trim()}
										type="button"
										onClick={() =>
											void run({
												type: "generate",
												assetId: staticHash,
												name:
													title || staticAsset?.name.slice(0, 30) || "Emoji",
												caption: { ...defaultCaption, text: caption },
												prompt,
											})
										}
									>
										Generate Motion Emoji
									</button>
									<button
										className="mc-button"
										type="button"
										disabled={busy || !staticSource}
										onClick={() => void makeStill()}
									>
										Use static image
									</button>
									<button
										className="mc-button"
										type="button"
										disabled={busy}
										onClick={() => void importGif()}
									>
										Import GIF
									</button>
								</div>
							</div>
						</div>
					</section>
					<section className="mc-panel">
						<div className="mc-toolbar">
							<h2>Generated Results</h2>
							<span className="mc-badge">{selected.length} selected</span>
						</div>
						{view?.store.drafts.length ? (
							<div
								className="emoji-results"
								role="listbox"
								aria-label="Generated animated Emoji"
								aria-multiselectable="true"
							>
								{view.store.drafts.map((id) => {
									const item = view.store.items.find((item) => item.id === id);
									return item ? (
										<div key={id} className="emoji-draft">
											<button
												key={id}
												type="button"
												role="option"
												aria-selected={selected.includes(id)}
												className="emoji-thumb"
												onClick={() =>
													setSelected((list) =>
														list.includes(id)
															? list.filter((entry) => entry !== id)
															: [...list, id],
													)
												}
											>
												<EmojiImage hash={item.rendered} alt={item.name} />
												<span>{item.name}</span>
											</button>
											<button
												className="mc-button"
												type="button"
												aria-label={`Edit draft ${item.name}`}
												onClick={() => edit(item)}
											>
												Edit
											</button>
										</div>
									) : null;
								})}
							</div>
						) : (
							<div className="mc-empty emoji-result-empty">
								<strong>Generated results will appear here</strong>
								<p>After generation, preview and add to a pack.</p>
							</div>
						)}
						<div className="mc-toolbar">
							<span className="muted">
								Results can be organized into a Package
							</span>
							<button
								className="mc-button"
								disabled={busy || selected.length === 0}
								type="button"
								onClick={() => {
									if (pack)
										void run({
											type: "command",
											command: {
												type: "add-drafts",
												packageId: pack.id,
												ids: selected,
											},
										}).then((next) => {
											if (next) setSelected([]);
										});
									else setNeedsPack(true);
								}}
							>
								Add to Pack
							</button>
						</div>
					</section>
				</div>
				<aside
					className="mc-aside emoji-library"
					aria-label="Emoji package library"
				>
					<div className="mc-toolbar">
						<h2>Package Library</h2>
						<button
							className="emoji-new"
							title="New emoji package"
							type="button"
							disabled={busy}
							onClick={() => void create()}
						>
							＋
						</button>
					</div>
					{view?.store.packages.length ? (
						<div className="emoji-pack-list">
							{view.store.packages.map((entry) => (
								<div
									className="emoji-pack"
									data-current={entry.id === packId}
									key={entry.id}
								>
									{rename?.id === entry.id ? (
										<input
											ref={(input) => {
												input?.focus();
											}}
											aria-label={`Rename ${entry.name}`}
											value={rename.name}
											onChange={(e) =>
												setRename({ id: entry.id, name: e.target.value })
											}
											onBlur={saveName}
											onKeyDown={(e) => {
												if (e.key === "Enter") saveName();
												if (e.key === "Escape") {
													renameCancelled.current = true;
													setRename(null);
												}
											}}
										/>
									) : (
										<button
											type="button"
											onClick={() => setPackId(entry.id)}
											onDoubleClick={() => {
												renameCancelled.current = false;
												setRename({ id: entry.id, name: entry.name });
											}}
											onContextMenu={(e) => {
												e.preventDefault();
												renameCancelled.current = false;
												setRename({ id: entry.id, name: entry.name });
											}}
										>
											<span className="emoji-pack-mark">▦</span>
											<span>
												<strong>{entry.name}</strong>
												<small>
													{entry.emojiIds.filter(Boolean).length} / 16
												</small>
											</span>
										</button>
									)}
									<div className="emoji-pack-tools">
										<button
											type="button"
											title={`Rename ${entry.name}`}
											onClick={() => {
												renameCancelled.current = false;
												setRename({ id: entry.id, name: entry.name });
											}}
										>
											Edit
										</button>
										<button
											type="button"
											title={`Delete ${entry.name}`}
											onClick={() =>
												setRemove({
													kind: "pack",
													id: entry.id,
													name: entry.name,
												})
											}
										>
											Delete
										</button>
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="mc-empty">
							<p>Create your first emoji pack</p>
							<button
								className="mc-button"
								type="button"
								onClick={() => void create()}
							>
								New Package
							</button>
						</div>
					)}
					{pack ? (
						<>
							<div className="mc-toolbar">
								<h3>Current Pack</h3>
								<span className="mc-badge">
									{pack.emojiIds.filter(Boolean).length} / 16
								</span>
							</div>
							<div className="emoji-pack-grid">
								{Array.from({ length: 16 }, (_, i) => ({
									slot: `${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
									index: i,
								})).map(({ slot, index: i }) => {
									const item = view?.store.items.find(
										(item) => item.id === pack.emojiIds[i],
									);
									return item ? (
										<div key={slot} className="emoji-pack-slot">
											<button
												type="button"
												title={`Edit ${item.name}`}
												onClick={() => edit(item)}
											>
												<EmojiImage hash={item.rendered} alt={item.name} />
											</button>
											<button
												type="button"
												title={`Delete ${item.name}`}
												onClick={() =>
													setRemove({
														kind: "emoji",
														id: item.id,
														name: item.name,
													})
												}
											>
												×
											</button>
										</div>
									) : (
										<span key={slot} className="emoji-empty-slot">
											＋
										</span>
									);
								})}
							</div>
							<button
								className="mc-button"
								data-primary
								disabled={busy || !pack.emojiIds.filter(Boolean).length}
								type="button"
								onClick={() => void run({ type: "place", id: pack.id })}
							>
								Add to Main Settings Screen
							</button>
							<button
								className="mc-button"
								disabled={busy || !pack.emojiIds.filter(Boolean).length}
								type="button"
								onClick={() => void run({ type: "export", id: pack.id })}
							>
								Export Emoji Pack
							</button>
							<p className="muted">
								Can be imported into WeChat, WeCom and other IM tools
							</p>
						</>
					) : null}
				</aside>
			</div>
			<p className="emoji-notice" role="status">
				{busy ? "Working…" : message}
			</p>
			{busy ? (
				<button
					className="mc-button"
					type="button"
					onClick={() => {
						generationVersion.current++;
						suggestionVersion.current++;
						void window.quakeEmoji?.request({ type: "cancel-generation" });
					}}
				>
					Cancel generation
				</button>
			) : null}
			{legacy ? (
				<Modal title="Generate Emoji" close={() => setLegacy(false)}>
					<label className="mc-field">
						Motion description
						<textarea
							value={legacyPrompt}
							onChange={(e) => setLegacyPrompt(e.target.value)}
						/>
					</label>
					<p role={utf8Length(legacyPrompt) >= 900 ? "status" : undefined}>
						{utf8Length(legacyPrompt)}/1000 bytes
					</p>
					<button
						className="mc-button"
						type="button"
						disabled={
							busy ||
							!staticHash ||
							!legacyPrompt.trim() ||
							utf8Length(legacyPrompt) > 1000
						}
						onClick={() => {
							setLegacy(false);
							void run({
								type: "generate",
								assetId: staticHash,
								prompt: legacyPrompt,
								name: title || "Emoji",
								caption: { ...defaultCaption, text: caption },
							});
						}}
					>
						Generate Emoji
					</button>
					<button
						className="mc-button"
						type="button"
						onClick={() => setLegacy(false)}
					>
						Cancel
					</button>
				</Modal>
			) : null}
			{needsPack ? (
				<Modal title="Create a package first" close={() => setNeedsPack(false)}>
					<p>Create a package to collect the selected emoji.</p>
					<button
						className="mc-button"
						data-primary
						type="button"
						onClick={() => void create().then(() => setNeedsPack(false))}
					>
						New Package
					</button>
				</Modal>
			) : null}
			{editing && view ? (
				<CaptionDialog
					key={editing.id}
					item={editing}
					source={editingSource}
					close={() => {
						suggestionVersion.current++;
						setSuggestion("");
						setEditing(null);
					}}
					suggestion={suggestion}
					suggest={() => {
						setSuggestion("");
						void run({
							type: "suggest-caption",
							prompt: editing.name || editing.caption.text || prompt,
							locale,
						});
					}}
					save={async (settings, bytes, name, mode) => {
						const next = await run({
							type: "caption",
							id: editing.id,
							name,
							mode,
							caption: settings,
							base64: base64(bytes),
						});
						if (next) setEditing(null);
					}}
				/>
			) : null}
			{settings && view ? (
				<AppMatchDialog
					view={view}
					run={run}
					close={() => setSettings(false)}
				/>
			) : null}
			{remove ? (
				<Modal title={`Delete ${remove.name}?`} close={() => setRemove(null)}>
					<p>
						{remove.kind === "pack"
							? "The package will be removed. Placed emoji keys keep their saved GIFs."
							: "This slot will be cleared. Saved keys keep working."}
					</p>
					<div className="emoji-actions">
						<button
							className="mc-button"
							type="button"
							onClick={() => setRemove(null)}
						>
							Cancel
						</button>
						<button
							className="mc-button"
							type="button"
							onClick={() => {
								void run({
									type: "command",
									command:
										remove.kind === "pack"
											? { type: "delete-package", id: remove.id }
											: {
													type: "remove-emoji",
													packageId: packId,
													id: remove.id,
												},
								});
								setRemove(null);
							}}
						>
							Delete
						</button>
					</div>
				</Modal>
			) : null}
		</div>
	);
}
function Modal({
	title,
	children,
	close,
}: {
	title: string;
	children: React.ReactNode;
	close: () => void;
}): React.JSX.Element {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		ref.current?.showModal();
		return () => ref.current?.close();
	}, []);
	return (
		<dialog ref={ref} className="mc-dialog" aria-label={title} onCancel={close}>
			<div className="mc-toolbar">
				<h2>{title}</h2>
				<button className="mc-button" type="button" onClick={close}>
					Close
				</button>
			</div>
			{children}
		</dialog>
	);
}
function CaptionDialog({
	item,
	source,
	close,
	save,
	suggestion,
	suggest,
}: {
	suggestion: string;
	suggest: () => void;
	item: EmojiItem;
	source: string;
	close: () => void;
	save: (
		caption: EmojiCaption,
		bytes: Uint8Array,
		name: string,
		mode: EmojiMode,
	) => Promise<void>;
}): React.JSX.Element {
	const [settings, setSettings] = useState(item.caption);
	const [name, setName] = useState(item.name);
	const [mode, setMode] = useState<EmojiMode>(item.mode ?? 1);
	const [preview, setPreview] = useState(source);
	useEffect(() => setPreview(source), [source]);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const render = async (commit: boolean): Promise<void> => {
		setBusy(true);
		try {
			const bytes = await captionGif(bytesOf(source), settings);
			setPreview(`data:image/gif;base64,${base64(bytes)}`);
			if (commit) await save(settings, bytes, name, mode);
		} catch {
			setMessage("Caption could not be rendered. The saved GIF was kept.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<Modal title={`Edit ${item.name}`} close={close}>
			<label className="mc-field">
				Emoji Name
				<input
					type="text"
					value={name}
					maxLength={30}
					onChange={(e) => setName(e.target.value)}
				/>
				<small>{name.length}/30</small>
			</label>
			<label className="mc-field">
				Emoji Action
				<select
					value={mode}
					onChange={(e) =>
						setMode(e.target.value === "0" ? 0 : e.target.value === "2" ? 2 : 1)
					}
				>
					<option value="0">Copy only</option>
					<option value="1">Copy and paste</option>
					<option value="2">Copy, paste and send</option>
				</select>
			</label>
			<button className="mc-button" type="button" onClick={suggest}>
				Suggest caption
			</button>
			{suggestion ? (
				<p role="status">
					{suggestion}{" "}
					<button
						className="mc-button"
						type="button"
						onClick={() => setSettings({ ...settings, text: suggestion })}
					>
						Use suggestion
					</button>
				</p>
			) : null}
			<div className="emoji-caption-layout">
				<img src={preview || undefined} alt="Caption preview" />
				<div>
					<label className="mc-field">
						Caption Text (Optional)
						<input
							value={settings.text}
							onChange={(e) => {
								if (weightedLength(e.target.value) <= 50)
									setSettings({ ...settings, text: e.target.value });
							}}
						/>
						<small>{weightedLength(settings.text)}/50</small>
					</label>
					<label className="mc-field">
						Font size
						<input
							type="range"
							min={12}
							max={100}
							value={settings.size}
							onChange={(e) =>
								setSettings({ ...settings, size: Number(e.target.value) })
							}
						/>
						<output>{settings.size} px</output>
					</label>
					<label className="mc-field">
						Position
						<select
							value={settings.position}
							onChange={(e) =>
								setSettings({
									...settings,
									position:
										e.target.value === "top"
											? "top"
											: e.target.value === "mid"
												? "mid"
												: "bot",
								})
							}
						>
							<option value="top">Top</option>
							<option value="mid">Middle</option>
							<option value="bot">Bottom</option>
						</select>
					</label>
					<label className="mc-field">
						Colour
						<input
							value={settings.color}
							maxLength={10}
							onChange={(e) =>
								setSettings({ ...settings, color: e.target.value })
							}
						/>
					</label>
					<div className="emoji-colours">
						{swatches.map((hex) => (
							<button
								key={hex}
								type="button"
								title={`#${hex}`}
								aria-label={`Colour #${hex}`}
								style={{ background: `#${hex}` }}
								onClick={() =>
									setSettings({ ...settings, color: `0x${hex}ff` })
								}
							/>
						))}
					</div>
				</div>
			</div>
			<p role="status">{message}</p>
			<div className="emoji-actions">
				<button
					className="mc-button"
					disabled={busy || !source}
					type="button"
					onClick={() => void render(false)}
				>
					Preview
				</button>
				<button
					className="mc-button"
					data-primary
					disabled={busy || !source}
					type="button"
					onClick={() => void render(true)}
				>
					Save
				</button>
			</div>
		</Modal>
	);
}
function AppMatchDialog({
	view,
	run,
	close,
}: {
	view: Ready;
	run: (request: EmojiRequest) => Promise<Ready | undefined>;
	close: () => void;
}): React.JSX.Element {
	const [enabled, setEnabled] = useState(view.store.appMatch);
	const [apps, setApps] = useState<readonly EmojiApp[]>(view.store.apps);
	const [available, setAvailable] = useState<readonly EmojiApp[]>([]);
	const [notice, setNotice] = useState("");
	const [query, setQuery] = useState("");
	const [mode, setMode] = useState<EmojiMode | null>(view.store.globalMode);
	return (
		<Modal title="App Match Settings" close={close}>
			<label>
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
				/>{" "}
				Enable app matching
			</label>
			<ul className="muted">
				<li>Only listed foreground apps can receive emoji.</li>
				<li>An empty app list allows every app.</li>
				<li>Turn matching off to use emoji in every app.</li>
			</ul>
			<label className="mc-field">
				Emoji Action
				<select
					value={mode === null ? "key" : String(mode)}
					onChange={(e) =>
						setMode(
							e.target.value === "key"
								? null
								: e.target.value === "0"
									? 0
									: e.target.value === "2"
										? 2
										: 1,
						)
					}
				>
					<option value="0">Copy Only</option>
					<option value="1">Copy and Paste</option>
					<option value="2">Copy, Paste and Send</option>
					<option value="key">Use key setting</option>
				</select>
			</label>
			<div className="mc-toolbar">
				<h3>Apps ({apps.length})</h3>
				<p role="status">{notice}</p>
				<button
					className="mc-button"
					type="button"
					onClick={() =>
						void run({ type: "installed-apps" }).then((reply) => {
							if (reply) setAvailable(reply.apps);
						})
					}
				>
					Add App
				</button>
				<button
					className="mc-button"
					type="button"
					onClick={() =>
						void run({ type: "pick-app" }).then((reply) => {
							if (reply) {
								const added = reply.apps.filter(
									(app) =>
										!apps.some(
											(entry) =>
												entry.path.toLowerCase() === app.path.toLowerCase() ||
												(app.identifier !== "" &&
													entry.identifier === app.identifier),
										),
								);
								setNotice(
									added.length < reply.apps.length
										? "This app has already been added."
										: "",
								);
								setApps([...apps, ...added]);
							}
						})
					}
				>
					Choose file…
				</button>
			</div>
			{apps.map((app) => (
				<div className="mc-toolbar" key={app.path}>
					<span>
						{app.name}
						<small className="muted"> {app.path}</small>
					</span>
					<button
						className="mc-button"
						type="button"
						onClick={() =>
							setApps(apps.filter((entry) => entry.path !== app.path))
						}
					>
						Delete
					</button>
				</div>
			))}
			{available.length ? (
				<>
					<label className="mc-field">
						Search apps
						<input value={query} onChange={(e) => setQuery(e.target.value)} />
					</label>
					<div className="emoji-app-list">
						{available
							.filter((app) =>
								`${app.name} ${app.path} ${app.identifier}`
									.toLowerCase()
									.includes(query.toLowerCase()),
							)
							.map((app) => (
								<button
									type="button"
									className="mc-button"
									key={app.path}
									disabled={apps.some((entry) => entry.path === app.path)}
									onClick={() => setApps([...apps, app])}
								>
									{app.name}
								</button>
							))}
					</div>
				</>
			) : null}
			<button
				className="mc-button"
				data-primary
				type="button"
				onClick={() =>
					void run({
						type: "command",
						command: {
							type: "settings",
							appMatch: enabled,
							apps,
							globalMode: mode,
						},
					}).then((reply) => {
						if (reply) close();
					})
				}
			>
				Save
			</button>
		</Modal>
	);
}

import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	AppLibrarySnapshot,
	appGroupIcon,
	appLibraryLabel,
} from "../../../../../../packages/device/src/profiles/app-library.js";
import { keyText } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { ShortcutLibrary } from "../../../../../../packages/edge/src/shortcuts/shortcut-contracts.js";
import type { EmojiReply } from "../../../shared/emoji";
import type { LibraryPack } from "../../../shared/key-library";
import { keyArtwork } from "./key-artwork";
import {
	appGroups,
	filterLibrary,
	functionGroups,
	type LibraryEntry,
	legacyAiGroups,
} from "./library-entries";
import "./function-library.css";

export function FunctionLibrary({
	locale,
	pageNumber,
	sequence,
	dragging,
	onPointerDown,
	onChoose,
	onActivate,
}: {
	readonly locale: ProfileLocale;
	readonly pageNumber: number;
	readonly sequence: boolean;
	readonly dragging?: string | undefined;
	readonly onPointerDown: (
		event: React.PointerEvent<HTMLButtonElement>,
		entry: LibraryEntry,
	) => void;
	readonly onChoose: (
		event: React.MouseEvent<HTMLButtonElement>,
		entry: LibraryEntry,
	) => void;
	readonly onActivate: (page: "shortcuts" | "emoji") => void;
}): React.JSX.Element {
	const [search, setSearch] = useState(""),
		[term, setTerm] = useState("");
	const [stored, setStored] = useState<AppLibrarySnapshot["groups"]>([]);
	const [legacy, setLegacy] = useState<AppLibrarySnapshot["groups"]>([]);
	const [generated, setGenerated] = useState<readonly ShortcutLibrary[]>([]);
	const [emoji, setEmoji] = useState<EmojiReply>();
	const [apps, setApps] = useState<readonly LibraryPack["icons"][number][]>([]);
	const [error, setError] = useState("");
	const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
	const generation = useRef(0);
	useEffect(() => {
		if (!search.trim()) {
			setTerm("");
			return;
		}
		const timer = setTimeout(() => setTerm(search), 500);
		return () => clearTimeout(timer);
	}, [search]);
	useEffect(() => {
		let live = true;
		const refresh = (): void => {
			const ticket = ++generation.current;
			setLegacy(legacyAiGroups(localStorage.getItem("ai-plugins")));
			const current = () => live && ticket === generation.current;
			void window.quakeKeyLibrary
				.request({ type: "app-library.read" })
				.then((reply) => {
					if (!current()) return;
					if (reply._tag === "success" && reply.appLibrary) {
						setStored(
							Schema.decodeUnknownSync(AppLibrarySnapshot)(reply.appLibrary)
								.groups,
						);
						setError("");
					} else if (reply._tag === "rejected") setError(reply.reason);
				})
				.catch(() => {
					if (current()) setError("App library could not be loaded.");
				});
			void window.quakeIntegrations
				?.request({ type: "shortcuts.list" })
				.then((reply) => {
					if (current() && reply.type === "libraries")
						setGenerated(reply.libraries);
				})
				.catch(() => {});
			void window.quakeEmoji
				?.request({ type: "read" })
				.then((reply) => {
					if (current() && reply._tag === "ready") setEmoji(reply);
				})
				.catch(() => {});
		};
		refresh();
		void window.quakeKeyLibrary
			.request({ type: "application-icons" })
			.then((reply) => {
				if (live && reply._tag === "success")
					setApps(reply.packs?.flatMap((pack) => pack.icons) ?? []);
			})
			.catch(() => {});
		const off = window.quakeKeyLibrary.onLibraryChange?.(refresh);
		window.addEventListener("focus", refresh);
		window.addEventListener("storage", refresh);
		return () => {
			live = false;
			generation.current++;
			off?.();
			window.removeEventListener("focus", refresh);
			window.removeEventListener("storage", refresh);
		};
	}, []);
	const groups = [
		...functionGroups(sequence, locale, pageNumber),
		...appGroups(stored, generated, emoji, sequence).map((group) => ({
			...group,
			name: group.emoji
				? keyText("aiPluginManager.emoji", locale)
				: keyText(group.name, locale),
		})),
		...appGroups(legacy, [], undefined, sequence).map((group) => ({
			...group,
			id: `legacy:${group.id}`,
			entries: group.entries.map((entry) => ({
				...entry,
				id: `legacy:${entry.id}`,
				activation: "shortcuts" as const,
			})),
		})),
	];
	const filtered = filterLibrary(groups, term, locale);
	const dragged = groups
		.flatMap((group) => group.entries)
		.find((entry) => entry.id === dragging);
	return (
		<section
			className="keys-library function-library"
			aria-label={locale === "de" ? "Aktionsbibliothek" : "Action library"}
		>
			<div className="function-library-toolbar">
				<label htmlFor="keys-library-search">
					{locale === "de" ? "Aktionen suchen" : "Search actions"}
				</label>
				<details className="function-library-add">
					<summary>{locale === "de" ? "Hinzufügen" : "Add"}</summary>
					<div>
						<button type="button" onClick={() => onActivate("shortcuts")}>
							{locale === "de" ? "KI-Kurzbefehle" : "AI shortcuts"}
						</button>
						<button type="button" onClick={() => onActivate("emoji")}>
							{locale === "de" ? "Emojis" : "Emojis"}
						</button>
					</div>
				</details>
			</div>
			<input
				id="keys-library-search"
				type="search"
				value={search}
				placeholder={keyText("searchPlaceholder", locale)}
				onChange={(event) => {
					setSearch(event.target.value);
					if (!event.target.value.trim()) {
						setTerm("");
						setOpened(new Set());
					}
				}}
			/>
			{error && (
				<p role="status">
					{error}
					<button
						type="button"
						onClick={() => window.dispatchEvent(new Event("focus"))}
					>
						{locale === "de" ? "Erneut versuchen" : "Retry"}
					</button>
				</p>
			)}
			<div className="function-library-groups">
				{filtered.map((group) => {
					const icon = appGroupIcon(group.name, apps);
					return (
						<details
							key={group.id}
							className="function-library-group"
							data-library-group={group.id}
							open={!!term.trim() || opened.has(group.id)}
							onToggle={(event) => {
								if (term.trim()) return;
								const expanded = event.currentTarget.open;
								setOpened((old) => {
									if (old.has(group.id) === expanded) return old;
									const next = new Set(old);
									if (expanded) next.add(group.id);
									else next.delete(group.id);
									return next;
								});
							}}
						>
							<summary>
								{icon ? (
									<img src={icon.data} alt="" width={24} height={24} />
								) : (
									<span
										className="function-library-group-icon"
										role="img"
										aria-label={group.emoji ? "Emoji menu" : "CPU"}
									>
										{group.emoji ? (
											"▦"
										) : (
											<svg
												width="24"
												height="24"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												aria-hidden="true"
											>
												<rect x="6" y="6" width="12" height="12" rx="2" />
												<path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4" />
												<rect x="9" y="9" width="6" height="6" />
											</svg>
										)}
									</span>
								)}
								<span>{group.name}</span>
								<small>{group.entries.length}</small>
							</summary>
							<div className="keys-library-items">
								{group.entries.map((entry) => {
									const label =
										entry.id === entry.key.config.type
											? keyText(
													entry.key.config.type === "delay"
														? "delayed"
														: entry.key.config.type,
													locale,
												)
											: appLibraryLabel(entry.key, locale);
									const icon =
										entry.key.config.icon.startsWith("emoji:") &&
										emoji?._tag === "ready"
											? emoji.assets[entry.key.config.icon.slice(6)]
											: keyArtwork(
													entry.key.config.icon,
													entry.key.config.type,
												);
									return (
										<button
											key={entry.id}
											type="button"
											className="function-library-item"
											data-library-type={entry.id}
											disabled={entry.disabled}
											aria-pressed={dragging === entry.id}
											title={
												entry.disabled
													? `${label} · ${locale === "de" ? "In Sequenzen noch nicht verfügbar" : "Not yet available in sequences"}`
													: label
											}
											onPointerDown={(event) => onPointerDown(event, entry)}
											onClick={(event) => onChoose(event, entry)}
										>
											<img src={icon} alt="" width={20} height={20} />
											<span>{label}</span>
											{entry.disabled && (
												<small>
													{locale === "de" ? "Nicht verfügbar" : "Unavailable"}
												</small>
											)}
										</button>
									);
								})}
							</div>
						</details>
					);
				})}
				{!filtered.length && (
					<p role="status">
						{locale === "de"
							? "Keine passenden Aktionen"
							: "No matching actions"}
					</p>
				)}
			</div>
			{dragged && (
				<div className="function-library-drag-preview" aria-hidden="true">
					<img
						src={keyArtwork(
							dragged.key.config.icon || `library:${dragged.id}`,
							dragged.key.config.type,
						)}
						alt=""
						width={20}
						height={20}
					/>
					{appLibraryLabel(dragged.key, locale)}
				</div>
			)}
		</section>
	);
}

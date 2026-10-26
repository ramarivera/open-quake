import { Option, Schema } from "effect";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	ACTION_REGISTRY,
	createActionDraft,
} from "../../../../../../packages/device/src/actions/action-registry.js";
import {
	type KeyTarget,
	keyEditable,
	keyText,
	keyTitle,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import {
	editKeyLayout,
	type KeyGeometry,
} from "../../../../../../packages/device/src/profiles/key-geometry.js";
import {
	createEmptyProfileKey,
	type Profile,
	ProfileEnvelope,
	ProfileKey,
	type ProfilePage,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { effectiveSpan } from "../../../../../../packages/device/src/profiles/profile-footprint.js";
import { occupiedCells } from "../../../../../../packages/device/src/profiles/profile-invariants.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { footprintRect, stripLayout, tileAt } from "../strip/geometry";
import { StripScreen, StripViewport } from "../strip/StripScreen";
import { useStripSettings } from "../strip/stripSettings";
import {
	type WallpaperController,
	WallpaperSettings,
} from "../wallpaper/WallpaperViews";
import { keyArtwork } from "./key-artwork";
export type Selection = {
	readonly target: KeyTarget;
	readonly key: ProfileKey;
	readonly geometry: KeyGeometry;
	readonly savedKey: ProfileKey;
};
type GridDrag = {
	readonly library?: string | undefined;
	readonly epoch: number;
	readonly key: ProfileKey;
	readonly profileId: string;
	readonly pageId: string;
	readonly revision: number;
};
const libraryTypes = [
	...ACTION_REGISTRY.map((entry) => entry.id),
	"createFolder",
	"brightness",
	"pageNo",
	"playAudio",
];
function libraryKey(
	type: string,
	code: string,
	pageNumber: number,
): ProfileKey {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
	const registered = ACTION_REGISTRY.find((entry) => entry.id === type);
	const fallback = keyArtwork(
		type === "brightness"
			? "0-1"
			: `library:${type}:${type === "pageNo" ? pageNumber : 1}`,
		type,
	);
	const icon =
		type === "pageNo"
			? `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="46" text-anchor="middle" font-family="sans-serif" font-size="44" fill="white">${pageNumber}</text></svg>`)}`
			: fallback;
	return Schema.decodeUnknownSync(ProfileKey)({
		...empty,
		childrenName: type,
		config: {
			...empty.config,
			...(registered
				? createActionDraft(registered.id)
				: {
						type,
						actions:
							type === "createFolder"
								? [{ type: "folder", value: `folder:${crypto.randomUUID()}` }]
								: [],
					}),
			title: { ...empty.config.title, text: keyText(type, "en") },
			icon,
			...(type === "hotkeySwitch" ? { alterIcon: icon } : {}),
			size: effectiveSpan(type, [1, 1]),
			supportTouchEffect: registered?.supportTouchEffect ?? false,
			compatibility: {
				defaultIcon: icon,
				...(type === "hotkeySwitch" ? { defaultAlterIcon: icon } : {}),
				pendingConfiguration: true,
				...(type === "pageNo" ? { pageNumber } : {}),
			},
		},
	});
}
export function GridEditor({
	profile,
	page,
	saving,
	serial,
	locale,
	selection,
	previewEnvelope,
	wallpaperController,
	current,
	epoch,
	savePending,
	resetRef,
	revert,
	save,
	choose,
	selectPage,
	setSelection,
	setStatus,
}: {
	readonly profile: Profile;
	readonly page: ProfilePage;
	readonly saving: boolean;
	readonly serial: string;
	readonly locale: ProfileLocale;
	readonly selection: Selection | undefined;
	readonly previewEnvelope: ProfileEnvelope;
	readonly wallpaperController: WallpaperController;
	readonly current: RefObject<Selection | undefined>;
	readonly epoch: RefObject<number>;
	readonly savePending: RefObject<boolean>;
	readonly resetRef: RefObject<(() => void) | undefined>;
	readonly revert: () => Promise<void>;
	readonly save: () => Promise<void>;
	readonly choose: (code: string) => Promise<void>;
	readonly selectPage: (profileId: string, pageId: string) => Promise<void>;
	readonly setSelection: (value: Selection) => void;
	readonly setStatus: (value: string) => void;
}): React.JSX.Element {
	const key = selection?.key;
	const layout = stripLayout(profile, page);
	const wallpaper = wallpaperController.snapshot;
	const { settings: stripSettings } = useStripSettings();
	const [mirrorPressed, setMirrorPressed] = useState<string>();
	useEffect(() => {
		if (saving) setMirrorPressed(undefined);
	}, [saving]);
	const drag = useRef<GridDrag | undefined>(undefined);
	const placementPending = useRef(false);
	const [dragging, setDragging] = useState<GridDrag>();
	const [dropCode, setDropCode] = useState<string>();
	const [dropAllowed, setDropAllowed] = useState(false);
	const [dropReason, setDropReason] = useState("shortcutGrid.spaceNotEnough");
	const [pendingDrop, setPendingDrop] = useState<{
		drag: GridDrag;
		code: string;
		names: readonly string[];
	}>();
	const [search, setSearch] = useState("");
	const [searchTerm, setSearchTerm] = useState("");
	const [vividSettings, setVividSettings] = useState(false);
	const pointer = useRef<
		{ x: number; y: number; start: () => void; active: boolean } | undefined
	>(undefined);
	const suppressClick = useRef(false);
	const returnPages = useRef(new Map<string, string[]>());
	useEffect(() => {
		const timer = setTimeout(() => setSearchTerm(search), 500);
		return () => clearTimeout(timer);
	}, [search]);
	const cancelDrag = (): void => {
		drag.current = undefined;
		setDragging(undefined);
		setDropCode(undefined);
	};
	const beginDrag = (library: string | undefined, keyCode = "1,1"): void => {
		if (!profile || !page || savePending.current || placementPending.current)
			return;
		const source = library
			? libraryKey(library, keyCode, profile.pages.indexOf(page) + 1)
			: current.current?.target.keyCode === keyCode
				? current.current.savedKey
				: page.keys.find((key) => key.keyCode === keyCode);
		if (
			!source ||
			(!library && (!source.config.type || !keyEditable(source, "allowDrag")))
		)
			return;
		const next: GridDrag = {
			epoch: epoch.current + 1,
			library,
			key: source,
			profileId: profile.id,
			pageId: page.id,
			revision: profile.revision,
		};
		void revert();
		drag.current = next;
		setDragging(next);
		setStatus(
			locale === "de"
				? "Ziel wählen. Eingabe zum Platzieren, Escape zum Abbrechen."
				: "Choose a target. Enter to place, Escape to cancel.",
		);
	};
	const dropDraft = (
		source: GridDrag,
		code: string,
		keys: readonly ProfileKey[],
	) => {
		const covering = keys.find(
			(key) =>
				key.config.type &&
				key.config.display &&
				occupiedCells(key).includes(code),
		);
		const size = effectiveSpan(source.key.config.type, source.key.config.size);
		const target =
			source.library === "playAudio"
				? "1,1"
				: !source.library && size.some((n) => n > 1)
					? (covering?.keyCode ?? code)
					: code;
		const key = source.library
			? { ...source.key, keyCode: target }
			: source.key;
		const geometry: KeyGeometry = source.library
			? { placement: true }
			: { destination: target };
		return {
			key,
			geometry,
			target,
			result: editKeyLayout(keys, key, geometry),
		};
	};
	const hoverDrop = (code?: string): void => {
		const source = drag.current;
		setDropCode(code);
		if (!source || !code || !profile || !page) return;
		const draft = dropDraft(source, code, page.keys);
		setDropReason(
			draft.result._tag === "rejected" && draft.result.reason === "locked"
				? "shortcutKeyNotAllowedToBeOverwritten"
				: `shortcutGrid.${draft.result._tag === "rejected" ? (draft.result.reason ?? "spaceNotEnough") : "spaceNotEnough"}`,
		);
		setDropAllowed(
			!stripLayout(profile, page).vivid && draft.result._tag !== "rejected",
		);
	};
	const place = async (
		code: string,
		confirmed = false,
		pending = pendingDrop,
	): Promise<void> => {
		const source = confirmed ? pending?.drag : drag.current;
		if (
			!source ||
			placementPending.current ||
			savePending.current ||
			!profile ||
			!page ||
			epoch.current !== source.epoch ||
			stripLayout(profile, page).vivid
		)
			return;
		placementPending.current = true;
		try {
			cancelDrag();
			setPendingDrop(undefined);
			// Re-read after rollback. Keep the gesture's original revision so concurrent edits fail.
			const reply = await window.quakeKeyLibrary.request({
				type: "read",
				locale,
			});
			if (
				reply._tag !== "success" ||
				!reply.envelope ||
				epoch.current !== source.epoch
			)
				return;
			const committed = Schema.decodeUnknownSync(ProfileEnvelope)(
				reply.envelope,
			);
			const p = committed.profiles.find(
				(value) => value.id === source.profileId,
			);
			const pg = p?.pages.find((value) => value.id === source.pageId);
			if (
				!p ||
				!pg ||
				profile.id !== source.profileId ||
				page.id !== source.pageId
			)
				return;
			if (p.revision !== source.revision) {
				setStatus("QUAKE.PROFILE.REVISION_CONFLICT");
				return;
			}
			const draft = dropDraft(source, code, pg.keys);
			if (draft.result._tag === "rejected") {
				setStatus(
					keyText(
						draft.result.reason === "locked"
							? "shortcutKeyNotAllowedToBeOverwritten"
							: `shortcutGrid.${draft.result.reason ?? "spaceNotEnough"}`,
						locale,
					),
				);
				return;
			}
			if (draft.result._tag === "confirmation" && !confirmed) {
				setPendingDrop({
					drag: source,
					code,
					names: draft.result.keyCodes.map((code) => {
						const key = pg.keys.find((key) => key.keyCode === code);
						return key
							? keyTitle(key, locale) || keyText(key.config.type, locale)
							: code;
					}),
				});
				return;
			}
			const next: Selection = {
				key: draft.key,
				savedKey: draft.key,
				geometry: { ...draft.geometry, replaceOverlaps: confirmed },
				target: {
					token: crypto.randomUUID(),
					profileId: p.id,
					pageId: pg.id,
					keyCode: draft.key.keyCode,
					revision: source.revision,
				},
			};
			current.current = next;
			setSelection(next);
			await save();
		} finally {
			placementPending.current = false;
		}
	};
	const enterKey = async (code: string): Promise<void> => {
		if (!profile || !page || savePending.current) return;
		const key = page.keys.find(
			(key) =>
				key.config.type &&
				key.config.display &&
				occupiedCells(key).includes(code),
		);
		if (!key) return;
		if (key.config.type === "multiActions") {
			await revert();
			await choose(key.keyCode);
			return;
		}
		const action = key.config.actions.find((action) =>
			["folder", "emojiFolderId", "parentFolder", "page"].includes(action.type),
		);
		const index = profile.pages.indexOf(page);
		let destination = ["nextPage", "previousPage"].includes(key.config.type)
			? profile.pages[
					(index +
						(key.config.type === "nextPage" ? 1 : profile.pages.length - 1)) %
						profile.pages.length
				]?.id
			: ["createFolder", "emojiFolder", "back", "emojiBack"].includes(
						key.config.type,
					) && typeof action?.value === "string"
				? action.value
				: key.config.type === "emojiBack"
					? profile.pages[0].id
					: undefined;
		const history = returnPages.current.get(profile.id) ?? [];
		if (key.config.type === "emojiBack")
			destination = history.at(-1) ?? destination ?? profile.pages[0].id;
		if (destination && profile.pages.some((page) => page.id === destination)) {
			if (["createFolder", "emojiFolder"].includes(key.config.type))
				returnPages.current.set(profile.id, [...history, page.id]);
			if (["back", "emojiBack"].includes(key.config.type))
				returnPages.current.set(profile.id, history.slice(0, -1));
			await selectPage(profile.id, destination);
		}
	};
	const pointerActions = useRef({ beginDrag, hoverDrop, place, cancelDrag });
	pointerActions.current = { beginDrag, hoverDrop, place, cancelDrag };
	useEffect(() => {
		const codeAt = (event: PointerEvent): string | undefined => {
			const element =
				document.elementFromPoint?.(event.clientX, event.clientY) ??
				event.target;
			return element instanceof Element
				? element.closest<HTMLElement>("[data-drop-code]")?.dataset.dropCode
				: undefined;
		};
		const move = (event: PointerEvent): void => {
			const value = pointer.current;
			if (!value) return;
			if (
				!value.active &&
				Math.hypot(event.clientX - value.x, event.clientY - value.y) > 5
			) {
				value.active = true;
				value.start();
			}
			if (value.active) pointerActions.current.hoverDrop(codeAt(event));
		};
		const up = (event: PointerEvent): void => {
			const value = pointer.current;
			pointer.current = undefined;
			if (!value?.active) return;
			suppressClick.current = true;
			const code = codeAt(event);
			if (code) void pointerActions.current.place(code);
			else pointerActions.current.cancelDrag();
		};
		const cancel = (): void => {
			pointer.current = undefined;
			pointerActions.current.cancelDrag();
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up);
		document.addEventListener("pointercancel", cancel);
		return () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			document.removeEventListener("pointercancel", cancel);
		};
	}, []);
	resetRef.current = () => {
		cancelDrag();
		setPendingDrop(undefined);
		setVividSettings(false);
	};
	useEffect(
		() => () => {
			resetRef.current = undefined;
		},
		[resetRef],
	);
	return (
		<>
			<section
				className="keys-library"
				aria-label={locale === "de" ? "Aktionsbibliothek" : "Action library"}
			>
				<label htmlFor="keys-library-search">
					{locale === "de" ? "Aktionen suchen" : "Search actions"}
				</label>
				<input
					id="keys-library-search"
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<div className="keys-library-items">
					{libraryTypes
						.filter((type) =>
							`${type} ${keyText(type, locale)}`
								.toLowerCase()
								.includes(searchTerm.toLowerCase()),
						)
						.map((type) => (
							<button
								type="button"
								key={type}
								data-library-type={type}
								onPointerDown={(event) => {
									if (event.button === 0) {
										suppressClick.current = false;
										pointer.current = {
											x: event.clientX,
											y: event.clientY,
											active: false,
											start: () => beginDrag(type),
										};
									}
								}}
								onClick={(event) => {
									if (suppressClick.current && event.detail > 0) {
										suppressClick.current = false;
										return;
									}
									beginDrag(type);
								}}
								aria-pressed={dragging?.library === type}
							>
								{keyText(type, locale)}
							</button>
						))}
				</div>
			</section>
			<fieldset
				className="keys-preview"
				onPointerDownCapture={(event) => {
					if (savePending.current) return;
					const rect =
						event.currentTarget
							.querySelector(".strip-screen")
							?.getBoundingClientRect() ??
						event.currentTarget.getBoundingClientRect();
					const tile = tileAt(
						{
							x: ((event.clientX - rect.left) * 1920) / rect.width,
							y: ((event.clientY - rect.top) * 480) / rect.height,
						},
						stripLayout(profile, page),
					);
					const key = page.keys.find((key) => key.keyCode === tile?.keyCode);
					const locked =
						key &&
						Option.isSome(key.config.basicEditableItems) &&
						!key.config.basicEditableItems.value.allowDrag;
					setMirrorPressed(locked ? undefined : tile?.keyCode);
				}}
				onPointerUpCapture={() => setMirrorPressed(undefined)}
				onPointerCancelCapture={() => setMirrorPressed(undefined)}
				onPointerLeave={() => setMirrorPressed(undefined)}
				onDragStartCapture={(event) => {
					event.preventDefault();
					setMirrorPressed(undefined);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") void revert();
				}}
				aria-label="Key grid preview"
				onClickCapture={(event) => {
					// Capture before nested controls, including programmatic clicks.
					event.preventDefault();
					event.stopPropagation();
					if (savePending.current) return;
					if (layout.vivid) {
						void revert();
						setVividSettings(true);
						return;
					}
					if (suppressClick.current && event.detail > 0) {
						suppressClick.current = false;
						return;
					}
					const hit =
						event.target instanceof Element
							? event.target.closest<HTMLElement>("[data-drop-code]")?.dataset
									.dropCode
							: undefined;
					if (hit) {
						if (drag.current) void place(hit);
						else void choose(hit);
						return;
					}
					const frame =
						event.currentTarget
							.querySelector(".strip-screen")
							?.getBoundingClientRect() ??
						event.currentTarget.getBoundingClientRect();
					const point = {
						x: ((event.clientX - frame.left) * 1920) / frame.width,
						y: ((event.clientY - frame.top) * 480) / frame.height,
					};
					const tile = tileAt(point, layout);
					const cell =
						tile?.keyCode ??
						layout.cells.find(
							(c) =>
								point.x >= c.rect.x &&
								point.x < c.rect.x + c.rect.width &&
								point.y >= c.rect.y &&
								point.y < c.rect.y + c.rect.height,
						)?.keyCode;
					if (cell) void choose(cell);
				}}
				onDoubleClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					const code =
						event.target instanceof Element
							? event.target.closest<HTMLElement>("[data-drop-code]")?.dataset
									.dropCode
							: undefined;
					if (code) void enterKey(code);
				}}
			>
				<StripViewport>
					<StripScreen
						titles="provided"
						pressedKeyCode={mirrorPressed}
						interactive={false}
						previewSerial="editor-preview"
						wallpaper={wallpaper}
						profiles={{ _tag: "ready", envelope: previewEnvelope }}
						showEmptyGridDashedBorder={stripSettings.showEmptyGridDashedBorder}
					/>
				</StripViewport>
				{layout.vivid ? (
					<button
						type="button"
						className="keys-vivid-configure"
						onClick={() => setVividSettings(true)}
					>
						{keyText("clickToConfigureColorfulScreen", locale)}
					</button>
				) : (
					<div className="keys-grid-targets" aria-hidden="true">
						{Array.from(
							{ length: 16 },
							(_, i) => `${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
						).map((code) => {
							const anchor =
								page.keys.find(
									(key) =>
										key.config.type &&
										key.config.display &&
										occupiedCells(key).includes(code),
								)?.keyCode ?? code;
							const [row = 1, column = 1] = code.split(",").map(Number);
							const rect = footprintRect(layout.theme, {
								row,
								column,
								width: 1,
								height: 1,
							});
							return (
								<div
									key={code}
									style={{
										left: `${rect.x / 19.2}%`,
										top: `${rect.y / 4.8}%`,
										width: `${rect.width / 19.2}%`,
										height: `${rect.height / 4.8}%`,
									}}
									data-drop-code={code}
									data-selected={key?.keyCode === anchor || undefined}
									data-drop={
										dropCode === code
											? dropAllowed
												? "allowed"
												: "forbidden"
											: undefined
									}
									onPointerDown={(event) => {
										if (event.button !== 0) return;
										suppressClick.current = false;
										pointer.current = {
											x: event.clientX,
											y: event.clientY,
											active: false,
											start: () => beginDrag(undefined, anchor),
										};
									}}
								/>
							);
						})}
					</div>
				)}
			</fieldset>
			{vividSettings && layout.vivid && (
				<section
					aria-label={keyText("clickToConfigureColorfulScreen", locale)}
					data-profile-id={profile.id}
					data-serial={serial}
				>
					<WallpaperSettings
						key={`${profile.id}:${serial}`}
						wallpaper={wallpaperController}
					/>
				</section>
			)}
			<fieldset
				className="keys-cells"
				aria-label="Select key"
				disabled={layout.vivid}
			>
				{Array.from(
					{ length: 16 },
					(_, i) => `${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
				).map((code) => (
					<button
						type="button"
						key={code}
						aria-pressed={key?.keyCode === code}
						data-drop-code={code}
						onPointerDown={(event) => {
							if (event.button !== 0) return;
							const anchor =
								page.keys.find(
									(key) =>
										key.config.type &&
										key.config.display &&
										occupiedCells(key).includes(code),
								)?.keyCode ?? code;
							suppressClick.current = false;
							pointer.current = {
								x: event.clientX,
								y: event.clientY,
								active: false,
								start: () => beginDrag(undefined, anchor),
							};
						}}
						data-drop={
							dropCode === code
								? dropAllowed
									? "allowed"
									: "forbidden"
								: undefined
						}
						onPointerEnter={() => {
							if (drag.current) hoverDrop(code);
						}}
						onClick={(event) => {
							if (suppressClick.current && event.detail > 0) {
								suppressClick.current = false;
								return;
							}
							if (drag.current) {
								void place(code);
							} else void choose(code);
						}}
						onDoubleClick={() => void enterKey(code)}
						onKeyDown={(event) => {
							if (event.key === " " && !drag.current) {
								event.preventDefault();
								beginDrag(undefined, code);
							}
							if (event.key === "Enter" && drag.current) {
								event.preventDefault();
								hoverDrop(code);
								void place(code);
							}
							if (
								["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
									event.key,
								)
							) {
								event.preventDefault();
								const buttons = [
									...(event.currentTarget.parentElement?.querySelectorAll(
										"button",
									) ?? []),
								];
								const i = buttons.indexOf(event.currentTarget);
								const next =
									buttons[
										(i +
											(event.key === "ArrowLeft"
												? 15
												: event.key === "ArrowRight"
													? 1
													: 8)) %
											16
									];
								next?.focus();
								if (next?.dataset.dropCode) hoverDrop(next.dataset.dropCode);
							}
						}}
					>
						{code}
					</button>
				))}
			</fieldset>
			{dropCode && dragging && (
				<p
					role="status"
					className="keys-drop-feedback"
					data-allowed={dropAllowed}
				>
					{dropAllowed
						? locale === "de"
							? `Platzieren bei ${dropCode}`
							: `Place at ${dropCode}`
						: keyText(dropReason, locale)}
				</p>
			)}
			{pendingDrop && (
				<div
					role="alertdialog"
					aria-modal="true"
					aria-label={keyText("shortcutGrid.replaceTitle", locale)}
				>
					<p>
						{keyText("shortcutGrid.replaceConfirm", locale).replace(
							"{names}",
							pendingDrop.names.join("、"),
						)}
					</p>
					<button
						type="button"
						onClick={() => void place(pendingDrop.code, true, pendingDrop)}
					>
						{keyText("shortcutGrid.confirmReplace", locale)}
					</button>
					<button
						type="button"
						onClick={() => {
							setPendingDrop(undefined);
							void revert();
						}}
					>
						{keyText("cancel", locale)}
					</button>
				</div>
			)}
			{!key && (
				<p className="keys-empty-hint">
					{keyText(
						Option.isSome(profile.compatibility) &&
							profile.compatibility.value.builtin
							? "defaultProfileHint"
							: "dragMessage",
						locale,
					)}
				</p>
			)}
		</>
	);
}

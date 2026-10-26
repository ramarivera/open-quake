import { Array as EffectArray, Option, Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ACTION_REGISTRY,
	createActionDraft,
} from "../../../../../../packages/device/src/actions/action-registry.js";
import { isObsId } from "../../../../../../packages/device/src/actions/obs-contracts";
import {
	editKeyTitle,
	type KeyTarget,
	keyEditable,
	keyText,
	keyTitle,
	localizedKey,
	resetKeyIcons,
	titleWeight,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { KeyGeometry } from "../../../../../../packages/device/src/profiles/key-geometry.js";
import {
	builtinProfiles,
	profileLabel,
} from "../../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { ClockSnapshot } from "../../../shared/clock-contracts";
import { ObsSettings } from "../obs/ObsSettings";
import { stripLayout, tileAt } from "../strip/geometry";
import { StripScreen, StripViewport } from "../strip/StripScreen";
import { ClockSettings } from "../strip/tiles/clock/ClockSettings";
import { patchClockEditorKey } from "../strip/tiles/clock/editorPatch";
import {
	isMonitorKey,
	MonitorKeySettings,
} from "../strip/tiles/monitor/MonitorKeySettings";
import { Group, PageHeader, Row } from "../ui/Form";
import { useWallpaper } from "../wallpaper/useWallpaper";
import { editableFocus } from "./editor-input";
import { NativeIconPicker } from "./IconPicker";
import { KeyGeometryControls } from "./KeyGeometryControls";
import { KeyImport } from "./KeyImport";
import { KeyPageControls } from "./KeyPageControls";
import { KeyTitleSettings } from "./KeyTitleSettings";
import { KnobEditor } from "./KnobEditor";
import { keyArtwork } from "./key-artwork";
import { KEY_LOCALE_STORAGE, storedKeyLocale } from "./key-locale";
import { SelectedKeyPreview } from "./SelectedKeyPreview";
import { SequenceEditor, withSequenceIds } from "./SequenceEditor";
import "./keys.css";

type Selection = {
	readonly target: KeyTarget;
	readonly key: ProfileKey;
	readonly geometry: KeyGeometry;
	readonly savedKey: ProfileKey;
};
export function KeyEditor(): React.JSX.Element {
	const { snapshot: wallpaper } = useWallpaper();
	const serial = wallpaper?.saved.serial ?? "desktop-preview";
	const [envelope, setEnvelope] = useState<ProfileEnvelope>(),
		[profileId, setProfileId] = useState(""),
		[pageId, setPageId] = useState(""),
		[locale, setLocale] = useState<ProfileLocale>(storedKeyLocale),
		[selection, setSelection] = useState<Selection>(),
		[icons, setIcons] = useState(false),
		[alternate, setAlternate] = useState(false),
		[status, setStatus] = useState(""),
		[saving, setSaving] = useState(false),
		[overlaps, setOverlaps] = useState<readonly string[]>([]);
	const savePending = useRef(false);
	const epoch = useRef(0);
	const current = useRef<Selection | undefined>(undefined),
		host = useRef<HTMLElement>(null);
	const accept = useCallback(
		(encoded: typeof ProfileEnvelope.Encoded) =>
			setEnvelope(Schema.decodeUnknownSync(ProfileEnvelope)(encoded)),
		[],
	);
	const read = useCallback(async (): Promise<void> => {
		const reply = await window.quakeKeyLibrary.request({
			type: "read",
			locale,
		});
		if (reply._tag === "success" && reply.envelope) accept(reply.envelope);
		else if (reply._tag === "rejected") setStatus(reply.reason);
	}, [accept, locale]);
	useEffect(() => {
		localStorage.setItem(KEY_LOCALE_STORAGE, locale);
		window.dispatchEvent(new Event("key-locale"));
	}, [locale]);
	const revert = useCallback(async (): Promise<void> => {
		if (savePending.current) return;
		const old = current.current;
		epoch.current++;
		current.current = undefined;
		setSelection(undefined);
		setIcons(false);
		setAlternate(false);
		setOverlaps([]);
		if (old)
			await window.quakeKeyLibrary.request({
				type: "revert",
				token: old.target.token,
			});
	}, []);
	useEffect(() => {
		void read();
	}, [read]);
	useEffect(() => {
		const off = window.quakeKeyLibrary.onPreview((snapshot) =>
			accept(snapshot.envelope),
		);
		return () => {
			off();
			epoch.current++;
			const old = current.current;
			current.current = undefined;
			if (old)
				void window.quakeKeyLibrary.request({
					type: "revert",
					token: old.target.token,
				});
		};
	}, [accept]);
	useEffect(
		() =>
			window.quakeClock?.onSnapshot((input) => {
				if (!Schema.is(ClockSnapshot)(input) || !input.target || !input.change)
					return;
				const target = input.target;
				const old = current.current;
				if (
					!old ||
					old.target.profileId !== target.profileId ||
					input.revision <= old.target.revision
				)
					return;
				const matches =
					old.target.pageId === target.pageId &&
					old.target.keyCode === target.keyCode;
				const next = {
					...old,
					key: matches ? patchClockEditorKey(old.key, input) : old.key,
					savedKey: matches
						? patchClockEditorKey(old.savedKey, input)
						: old.savedKey,
					target: { ...old.target, revision: input.revision },
				};
				current.current = next;
				setSelection(next);
				setEnvelope((envelope) =>
					!envelope
						? envelope
						: {
								...envelope,
								profiles: EffectArray.map(envelope.profiles, (p) =>
									p.id !== target.profileId
										? p
										: {
												...p,
												revision: input.revision,
												pages: EffectArray.map(p.pages, (page) =>
													page.id !== target.pageId
														? page
														: {
																...page,
																keys: page.keys.map((key) =>
																	key.keyCode !== target.keyCode
																		? key
																		: patchClockEditorKey(key, input),
																),
															},
												),
											},
								),
							},
				);
			}),
		[],
	);

	const profile =
		envelope?.profiles.find((p) => p.id === profileId) ?? envelope?.profiles[0];
	const page =
		profile?.pages.find((p) => p.id === pageId) ??
		profile?.pages.find(
			(p) => p.id === envelope?.activeByDevice[serial]?.pageId,
		) ??
		profile?.pages[0];
	const update = async (
		key: ProfileKey,
		token?: string,
		geometry?: KeyGeometry,
	): Promise<void> => {
		const old = current.current;
		if (savePending.current || !old || (token && old.target.token !== token))
			return;
		const next = {
			...old,
			key,
			geometry: geometry ?? { ...old.geometry, replaceOverlaps: false },
		};
		current.current = next;
		setSelection(next);
		setStatus("");
		const reply = await window.quakeKeyLibrary.request({
			type: "preview",
			target: next.target,
			key: Schema.encodeSync(ProfileKey)(key),
			geometry: next.geometry,
		});
		if (current.current !== next) return;
		setOverlaps(reply._tag === "rejected" ? (reply.keyCodes ?? []) : []);
		if (
			reply._tag === "rejected" &&
			current.current?.target.token === next.target.token
		)
			setStatus(
				reply.keyCodes
					? ""
					: locale === "de" && reply.reason === "layout-locked-or-invalid"
						? "Diese Änderung ist gesperrt oder überlappt andere Tasten."
						: reply.reason === "layout-locked-or-invalid"
							? "This edit is locked or overlaps other keys."
							: reply.reason,
			);
	};
	const selectPage = async (
		nextProfile: string,
		nextPage: string,
	): Promise<void> => {
		if (savePending.current) return;
		const ticket = epoch.current + 1;
		await revert();
		if (epoch.current !== ticket) return;
		const reply = await window.quakeKeyLibrary.request({
			type: "select",
			deviceId: serial,
			profileId: nextProfile,
			pageId: nextPage,
		});
		if (epoch.current !== ticket) return;
		if (reply._tag === "rejected") {
			setStatus(reply.reason);
			return;
		}
		setProfileId(nextProfile);
		setPageId(nextPage);
		if (reply.envelope) accept(reply.envelope);
	};
	const editPage = async (
		type: "add-page" | "delete-page",
		id: string,
	): Promise<void> => {
		if (!profile || savePending.current) return;
		await revert();
		savePending.current = true;
		setSaving(true);
		setStatus("");
		try {
			const reply = await window.quakeKeyLibrary.request({
				type,
				profileId: profile.id,
				pageId: id,
				revision: profile.revision,
				deviceId: serial,
			});
			if (reply._tag === "rejected") setStatus(reply.reason);
			else if (reply._tag === "success" && reply.envelope) {
				accept(reply.envelope);
				const selected = reply.envelope.activeByDevice[serial];
				setPageId(
					selected?.profileId === profile.id
						? selected.pageId
						: (reply.envelope.profiles.find((p) => p.id === profile.id)
								?.pages[0].id ?? ""),
				);
			}
		} finally {
			savePending.current = false;
			setSaving(false);
		}
	};
	const choose = async (keyCode: string): Promise<void> => {
		if (savePending.current) return;
		const ticket = epoch.current + 1;
		await revert();
		if (!profile || !page || epoch.current !== ticket) return;
		const selected = await window.quakeKeyLibrary.request({
			type: "select",
			deviceId: serial,
			profileId: profile.id,
			pageId: page.id,
		});
		if (selected._tag === "rejected" || epoch.current !== ticket) return;
		// Re-read committed data after reverting before establishing the next target.
		const reply = await window.quakeKeyLibrary.request({
			type: "read",
			locale,
		});
		if (reply._tag !== "success" || !reply.envelope || epoch.current !== ticket)
			return;
		const env = Schema.decodeUnknownSync(ProfileEnvelope)(reply.envelope),
			p = env.profiles.find((p) => p.id === profile.id),
			pg = p?.pages.find((pg) => pg.id === page.id);
		if (!p || !pg) return;
		accept(reply.envelope);
		const key = withSequenceIds(
			pg.keys.find((k) => k.keyCode === keyCode) ??
				createEmptyProfileKey(keyCode),
		);
		const next = {
			key,
			geometry: {},
			savedKey: key,
			target: {
				token: crypto.randomUUID(),
				profileId: p.id,
				pageId: pg.id,
				keyCode,
				revision: p.revision,
			},
		};
		current.current = next;
		setSelection(next);
	};
	const save = async (): Promise<void> => {
		const old = current.current;
		if (!old || savePending.current) return;
		const ticket = epoch.current;
		const ownsSave = (): boolean =>
			epoch.current === ticket && current.current === old;
		// The ref closes the event-to-render gap for double Save and queued callbacks.
		savePending.current = true;
		setSaving(true);
		setStatus("");
		try {
			const preview = await window.quakeKeyLibrary.request({
				type: "preview",
				target: old.target,
				key: Schema.encodeSync(ProfileKey)(old.key),
				geometry: old.geometry,
			});
			if (!ownsSave()) {
				// Unmount may have reverted before this delayed preview reached main.
				await window.quakeKeyLibrary.request({
					type: "revert",
					token: old.target.token,
				});
				return;
			}
			if (preview._tag !== "success") {
				setOverlaps(preview.keyCodes ?? []);
				if (!preview.keyCodes) setStatus(preview.reason);
				return;
			}
			const reply = await window.quakeKeyLibrary.request({
				type: "save",
				token: old.target.token,
			});
			if (!ownsSave()) return;
			if (reply._tag === "rejected") {
				setStatus(reply.reason);
				return;
			}
			if (reply.envelope) {
				accept(reply.envelope);
				const p = reply.envelope.profiles.find(
					(p) => p.id === old.target.profileId,
				);
				const destination = old.geometry.destination ?? old.target.keyCode;
				const savedKey = { ...old.key, keyCode: destination };
				const next = {
					...old,
					key: savedKey,
					geometry: {},
					savedKey,
					target: {
						...old.target,
						keyCode: destination,
						revision: p?.revision ?? old.target.revision,
					},
				};
				current.current = next;
				setSelection(next);
			}
			setIcons(false);
			setOverlaps([]);
			setStatus(keyText("savedSuccessfully", locale));
		} finally {
			savePending.current = false;
			if (epoch.current === ticket) setSaving(false);
		}
	};
	const remove = useCallback(async (): Promise<void> => {
		const old = current.current;
		if (savePending.current || !old || !keyEditable(old.key, "allowDelete"))
			return;
		const reply = await window.quakeKeyLibrary.request({
			type: "delete",
			target: old.target,
		});
		if (reply._tag === "rejected") setStatus(reply.reason);
		else {
			if (reply.envelope) accept(reply.envelope);
			current.current = undefined;
			setSelection(undefined);
			setIcons(false);
		}
	}, [accept]);
	useEffect(() => {
		const keyup = (event: KeyboardEvent): void => {
			if (
				event.key === "Delete" &&
				!event.isComposing &&
				!editableFocus(document.activeElement) &&
				!editableFocus(event.target instanceof Element ? event.target : null)
			) {
				event.preventDefault();
				void remove();
			}
		};
		const away = (event: PointerEvent): void => {
			if (event.target instanceof Node && !host.current?.contains(event.target))
				void revert();
		};
		window.addEventListener("keyup", keyup);
		document.addEventListener("pointerdown", away);
		return () => {
			window.removeEventListener("keyup", keyup);
			document.removeEventListener("pointerdown", away);
		};
	}, [remove, revert]);
	if (!envelope || !profile || !page)
		return <p role="status">{status || "Loading profiles…"}</p>;
	const previewProfile = {
		...profile,
		pages: EffectArray.map(profile.pages, (p) => ({
			...p,
			keys: p.keys.map((k) => {
				const translated = localizedKey(k, locale);
				if (
					!alternate ||
					selection?.target.profileId !== profile.id ||
					selection.target.pageId !== p.id ||
					selection.target.keyCode !== k.keyCode ||
					k.config.type !== "hotkeySwitch"
				)
					return translated;
				return {
					...translated,
					config: {
						...translated.config,
						title: Option.getOrElse(
							translated.config.alterTitle,
							() => translated.config.title,
						),
						icon:
							Option.getOrElse(translated.config.alterIcon, () => "") ||
							translated.config.icon,
					},
				};
			}),
		})),
	};
	const previewEnvelope = {
		...envelope,
		profiles: [previewProfile] as const,
		activeByDevice: {
			"editor-preview": { profileId: profile.id, pageId: page.id },
		},
	};
	const key = selection?.key;
	const selectedTile = stripLayout(
		previewProfile,
		previewProfile.pages.find((p) => p.id === page.id) ?? page,
	).tiles.find((tile) => tile.keyCode === key?.keyCode);
	const changeActions = (index: number, value: string): void => {
		if (!key) return;
		void update({
			...key,
			config: {
				...key.config,
				actions: key.config.actions.map((a, i) =>
					i === index
						? {
								...a,
								value:
									typeof a.value === "number" ||
									a.type === "time" ||
									a.type === "page"
										? Number(value)
										: value,
							}
						: a,
				),
			},
		});
	};
	const resetIcon = (): void => {
		if (!key) return;
		const platform = navigator.platform.includes("Mac") ? "darwin" : "win32";
		const original = builtinProfiles(platform)
			.find((p) => p.id === profile.id)
			?.pages.filter((p) => p.id === page.id)
			.flatMap((p) => p.keys)
			.find((k) => k.keyCode === key.keyCode);
		const reset = resetKeyIcons(key, original);
		void update({
			...reset,
			config: {
				...reset.config,
				icon: keyArtwork(reset.config.icon, reset.config.type),
				alterIcon: Option.map(reset.config.alterIcon, (icon) =>
					keyArtwork(icon, reset.config.type),
				),
			},
		});
		setIcons(false);
		setAlternate(false);
	};
	return (
		<section className="key-editor" ref={host} aria-busy={saving}>
			<PageHeader title="Keys" />
			<fieldset className="keys-save-boundary" disabled={saving}>
				<Group title="Configuration">
					<Row label="Profile" htmlFor="keys-profile">
						<select
							id="keys-profile"
							value={profile.id}
							onChange={(e) => {
								const next = envelope.profiles.find(
									(p) => p.id === e.target.value,
								);
								if (next) void selectPage(next.id, next.pages[0].id);
							}}
						>
							{envelope.profiles.map((p) => (
								<option key={p.id} value={p.id}>
									{profileLabel(p, locale)}
								</option>
							))}
						</select>
					</Row>
					<Row label={keyText("pageNumber", locale)} htmlFor="keys-page">
						<select
							id="keys-page"
							value={page.id}
							onChange={(e) => {
								void selectPage(profile.id, e.target.value);
							}}
						>
							{profile.pages.map((p, i) => (
								<option key={p.id} value={p.id}>
									{i + 1}
								</option>
							))}
						</select>
					</Row>
					<KeyPageControls
						key={`${profile.id}:${page.id}`}
						profile={profile}
						pageId={page.id}
						locale={locale}
						select={(id) => void selectPage(profile.id, id)}
						edit={(type, id) => void editPage(type, id)}
					/>
					<Row label="Language" htmlFor="keys-language">
						<select
							id="keys-language"
							value={locale}
							onChange={(e) =>
								setLocale(
									Schema.decodeUnknownSync(ProfileLocale)(e.target.value),
								)
							}
						>
							{["en", "zh", "de", "es", "fr", "it", "ja", "ko"].map((l) => (
								<option key={l}>{l}</option>
							))}
						</select>
					</Row>
				</Group>
				<KnobEditor
					key={profile.id}
					profile={profile}
					accept={accept}
					keyEditOpen={selection !== undefined || saving}
				/>
				<fieldset
					className="keys-preview"
					onKeyDown={(event) => {
						if (event.key === "Escape") void revert();
					}}
					aria-label="Key grid preview"
					onClickCapture={(event) => {
						// Capture before nested controls, including programmatic clicks.
						event.preventDefault();
						event.stopPropagation();
						const frame = event.currentTarget.getBoundingClientRect();
						const point = {
							x: ((event.clientX - frame.left) * 1920) / frame.width,
							y: ((event.clientY - frame.top) * 480) / frame.height,
						};
						const layout = stripLayout(profile, page),
							tile = tileAt(point, layout);
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
				>
					<StripViewport>
						<StripScreen
							titles="provided"
							interactive={false}
							previewSerial="editor-preview"
							wallpaper={wallpaper}
							profiles={{ _tag: "ready", envelope: previewEnvelope }}
							showEmptyGridDashedBorder
						/>
					</StripViewport>
				</fieldset>
				<fieldset className="keys-cells" aria-label="Select key">
					{Array.from(
						{ length: 16 },
						(_, i) => `${Math.floor(i / 8) + 1},${(i % 8) + 1}`,
					).map((code) => (
						<button
							type="button"
							key={code}
							aria-pressed={key?.keyCode === code}
							onClick={() => void choose(code)}
						>
							{code}
						</button>
					))}
				</fieldset>
				{key ? (
					<Group
						title={
							keyTitle(key, locale) || key.config.type || "Select Function"
						}
					>
						{selectedTile && selection && (
							<SelectedKeyPreview
								tile={selectedTile}
								target={{
									profileId: profile.id,
									pageId: page.id,
									keyCode: key.keyCode,
								}}
								beforeWrite={async () => {
									const old = current.current;
									if (!old || savePending.current) return false;
									if (
										JSON.stringify(Schema.encodeSync(ProfileKey)(old.key)) ===
										JSON.stringify(Schema.encodeSync(ProfileKey)(old.savedKey))
									)
										return true;
									await save();
									return old !== current.current;
								}}
								onSaved={() => choose(key.keyCode)}
								isCurrent={() =>
									current.current?.target.token === selection.target.token
								}
							/>
						)}
						{Option.isSome(key.compatibility) &&
							key.compatibility.value.unsupported === true && (
								<p role="status" className="key-unsupported">
									{locale === "de"
										? "Nicht unterstützte Funktion. Die Originaldaten bleiben erhalten und werden nicht ausgeführt."
										: "Unsupported function. Original data is preserved and won't execute."}
								</p>
							)}
						<Row label="Function" htmlFor="key-function">
							<select
								id="key-function"
								disabled={!keyEditable(key, "allowDelete")}
								value={key.config.type}
								onChange={(e) => {
									if (savePending.current) return;
									const entry = ACTION_REGISTRY.find(
										(a) => a.id === e.target.value,
									);
									if (!entry) return;
									const raw = Schema.encodeSync(ProfileKey)(key);
									const next = Schema.decodeUnknownSync(ProfileKey)({
										...raw,
										...(raw.compatibility?.unsupported === true
											? {
													compatibility: {
														...raw.compatibility,
														unsupported: false,
													},
												}
											: {}),
										childrenName: entry.id,
										config: {
											...raw.config,
											...createActionDraft(entry.id),
											supportKnob: entry.id === "obsVolume",
											supportTouchEffect: entry.supportTouchEffect,
										},
									});
									setIcons(false);
									setAlternate(false);
									void update(next);
								}}
							>
								<option value={key.config.type}>
									{key.config.type
										? keyText(key.config.type, locale)
										: "Select Function"}
								</option>
								{ACTION_REGISTRY.filter((a) => a.id !== key.config.type).map(
									(a) => (
										<option key={a.id} value={a.id}>
											{keyText(a.id, locale)}
										</option>
									),
								)}
							</select>
						</Row>
						<Row label={keyText("title", locale)} htmlFor="key-title">
							<input
								id="key-title"
								disabled={!keyEditable(key, "title")}
								value={keyTitle(key, locale, alternate)}
								onChange={(e) =>
									void update(editKeyTitle(key, e.target.value, alternate))
								}
							/>
							<small
								data-warning={
									titleWeight(keyTitle(key, locale, alternate)) > 16
								}
							>
								{titleWeight(keyTitle(key, locale, alternate))}/20
							</small>
						</Row>
						<KeyGeometryControls
							keyValue={key}
							geometry={selection?.geometry ?? {}}
							locale={locale}
							onChange={(next, geometry) =>
								void update(next, undefined, geometry)
							}
						/>
						{overlaps.length > 0 && (
							<div
								role="alertdialog"
								aria-label={
									locale === "de"
										? "Ersetzung bestätigen"
										: "Replace Confirmation"
								}
							>
								<p>
									{locale === "de"
										? "Diese Felder werden ersetzt"
										: "Placing here will replace the existing component(s)"}
									: {overlaps.join(", ")}
								</p>
								<button
									type="button"
									id="key-confirm-overlap"
									onClick={() =>
										void update(key, undefined, {
											...selection?.geometry,
											replaceOverlaps: true,
										})
									}
								>
									{locale === "de" ? "Ersetzen bestätigen" : "Confirm Replace"}
								</button>
								<button type="button" onClick={() => void revert()}>
									{keyText("cancel", locale)}
								</button>
							</div>
						)}
						<KeyTitleSettings
							keyValue={key}
							alternate={alternate}
							locale={locale}
							onChange={(next) => void update(next)}
						/>
						{key.config.type === "hotkeySwitch" && (
							<Row label="State">
								<button
									type="button"
									aria-pressed={!alternate}
									onClick={() => {
										setIcons(false);
										setAlternate(false);
									}}
								>
									1
								</button>
								<button
									type="button"
									aria-pressed={alternate}
									onClick={() => {
										setIcons(false);
										setAlternate(true);
									}}
								>
									2
								</button>
							</Row>
						)}
						<Row label={keyText("selectDecoKeeIcon", locale)}>
							<button
								type="button"
								disabled={!keyEditable(key, "icon")}
								onClick={() => setIcons((value) => !value)}
							>
								{keyText("iconLib.title", locale)}
							</button>
							<button
								type="button"
								disabled={!keyEditable(key, "icon")}
								aria-label="Reset icon to default"
								onClick={resetIcon}
							>
								Reset to default
							</button>
						</Row>

						{isMonitorKey(key) && (
							<MonitorKeySettings
								key={selection?.target.token}
								keyValue={key}
								locale={locale}
								onChange={(next) => void update(next)}
							/>
						)}
						{isObsId(key.config.type) && (
							<ObsSettings
								key={key.config.type}
								keyValue={key}
								locale={locale}
								onChange={(next) => void update(next)}
							/>
						)}
						{key.config.actions
							.filter(
								() =>
									key.config.type !== "dkDesktopClock" &&
									!isObsId(key.config.type) &&
									!isMonitorKey(key),
							)
							.map((action, index) => (
								<Row
									key={`${action.type}:${action.type === "key" ? (index === 0 ? "primary" : "alternate") : "setting"}`}
									label={
										action.type === "key"
											? index === 0
												? keyText("hotKey1", locale)
												: keyText("hotKey2", locale)
											: action.type
									}
									htmlFor={`key-action-${index}`}
								>
									<input
										id={`key-action-${index}`}
										type={
											action.type === "time" || action.type === "page"
												? "number"
												: "text"
										}
										value={
											typeof action.value === "string" ||
											typeof action.value === "number"
												? action.value
												: JSON.stringify(action.value)
										}
										onChange={(e) => changeActions(index, e.target.value)}
									/>
								</Row>
							))}
						{key.config.type === "multiActions" && (
							<SequenceEditor
								value={Option.getOrElse(key.config.subActions, () => [])}
								onChange={(value) =>
									void update({
										...key,
										config: { ...key.config, subActions: Option.some(value) },
									})
								}
							/>
						)}
						<Row label="">
							<button
								type="button"
								className="button-primary"
								onClick={() => void save()}
							>
								{keyText("save", locale)}
							</button>
							<button type="button" onClick={() => void revert()}>
								{keyText("cancel", locale)}
							</button>
							<button
								type="button"
								disabled={!keyEditable(key, "allowDelete")}
								onClick={() => void remove()}
							>
								Delete
							</button>
						</Row>
					</Group>
				) : (
					<p>Select a key to edit.</p>
				)}
				<KeyImport
					locale={locale}
					accept={(reply) => {
						if (
							reply._tag !== "success" ||
							!reply.envelope ||
							!reply.importedProfileId
						)
							return;
						accept(reply.envelope);
						const imported = reply.envelope.profiles.find(
							(p) => p.id === reply.importedProfileId,
						);
						if (imported) void selectPage(imported.id, imported.pages[0].id);
					}}
				/>
				{icons && key && selection && (
					<NativeIconPicker
						key={`${selection.target.token}:${alternate}:${key.config.type}`}
						token={selection.target.token}
						locale={locale}
						onClose={(reason) => {
							setIcons(false);
							if (reason) setStatus(reason);
						}}
						onSelect={(data, source) => {
							const active = current.current;
							if (!active || active.target.token !== selection.target.token)
								return;
							void update(
								{
									...active.key,
									config: {
										...active.key.config,
										compatibility: Option.some({
											...Option.getOrElse(
												active.key.config.compatibility,
												() => ({}),
											),
											[alternate ? "alternateIconSource" : "iconSource"]:
												source ?? data,
										}),
										...(alternate
											? { alterIcon: Option.some(data) }
											: { icon: data }),
									},
								},
								active.target.token,
							);
						}}
					/>
				)}
				{key?.config.type === "dkDesktopClock" && (
					<ClockSettings
						draftHourFormat={
							key.config.actions.find((a) => a.type === "hourFormat")?.value ===
							"12h"
								? "12h"
								: "24h"
						}
						onHourFormat={(hourFormat) => {
							const active = current.current;
							if (!active) return;
							const actions = active.key.config.actions;
							void update({
								...active.key,
								config: {
									...active.key.config,
									actions: actions.some((a) => a.type === "hourFormat")
										? actions.map((a) =>
												a.type === "hourFormat"
													? { ...a, value: hourFormat }
													: a,
											)
										: [...actions, { type: "hourFormat", value: hourFormat }],
								},
							});
						}}
						target={
							selection
								? {
										profileId: selection.target.profileId,
										pageId: selection.target.pageId,
										keyCode: selection.key.keyCode,
									}
								: undefined
						}
					/>
				)}
			</fieldset>
			{saving && <p role="status">Saving…</p>}
			{status && <p role="status">{status}</p>}
		</section>
	);
}

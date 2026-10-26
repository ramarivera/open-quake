import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	intervalMillis,
	reorderWallpaper,
	type WallpaperSettings,
} from "../../../shared/display";
import { WallpaperReply } from "../../../shared/wallpaper-contracts";
import { useAppTranslations } from "../i18n";
import { WallpaperPlaylist } from "./WallpaperPlaylist";
import type { WallpaperController } from "./WallpaperViews";

/** A serial/revision owns this draft. Key Save never enters this transaction. */
export function WallpaperEditor({
	wallpaper,
}: {
	wallpaper: WallpaperController;
}): React.JSX.Element {
	const t = useAppTranslations("wallpaper");
	const initial = wallpaper.snapshot?.saved;
	const [draft, setDraft] = useState(initial?.settings);
	const [confirm, setConfirm] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const gate = useRef(false);
	const generation = useRef(0);
	useEffect(
		() => () => {
			generation.current++;
		},
		[],
	);
	const selected = initial
		? { serial: initial.serial, revision: initial.revision }
		: undefined;
	const patch = (value: Partial<WallpaperSettings>) =>
		setDraft((old) => (old ? { ...old, ...value } : old));
	const pick = async () => {
		if (!selected || !draft || gate.current) return;
		const ticket = generation.current;
		gate.current = true;
		setBusy(true);
		setMessage("");
		try {
			const raw = await window.quakeWallpaper?.request({
				_tag: "pick",
				...selected,
			});
			if (ticket !== generation.current) return;
			if (!Schema.is(WallpaperReply)(raw) || raw._tag === "failure") {
				setMessage(t("savedUnreadable"));
				return;
			}
			const items = raw.snapshot.saved.settings.displayMediaList;
			if (raw.snapshot.asset._tag === "ready")
				setDraft((old) =>
					old
						? {
								...old,
								displayMediaList: [
									...items.filter(
										(item) =>
											!old.displayMediaList.some(
												(m) => m.filePath === item.filePath,
											),
									),
									...old.displayMediaList,
								],
							}
						: old,
				);
		} catch {
			if (ticket === generation.current) setMessage(t("savedUnreadable"));
		} finally {
			gate.current = false;
			if (ticket === generation.current) setBusy(false);
		}
	};
	if (!draft || !selected) return <p role="status">{t("loading")}</p>;
	const save = async () => {
		const duration = intervalMillis(draft.gapInterval, draft.gapIntervalUnit);
		if (!duration || gate.current) return;
		gate.current = true;
		setBusy(true);
		try {
			await wallpaper.request({
				_tag: "save",
				...selected,
				settings: {
					...draft,
					displayMediaList: draft.displayMediaList.map((m) => ({
						...m,
						duration,
					})),
				},
			});
		} finally {
			gate.current = false;
			setBusy(false);
		}
	};
	return (
		<section
			className="wallpaper-settings"
			aria-label={t("editor")}
			data-serial={selected.serial}
		>
			<p>{selected.serial}</p>
			<fieldset disabled={busy || wallpaper.busy}>
				<label>
					{t("method")}
					<select
						aria-label={t("method")}
						value={draft.isTransparent ? "transparent" : "custom"}
						onChange={(e) =>
							patch({ isTransparent: e.target.value === "transparent" })
						}
					>
						<option value="custom">{t("custom")}</option>
						<option value="transparent">{t("transparent")}</option>
					</select>
				</label>
				<label>
					{t("fit")}
					<select
						aria-label={t("fit")}
						value={draft.bgFillMode}
						onChange={(e) => {
							const value = e.target.value;
							if (
								value === "cover" ||
								value === "contain" ||
								value === "center"
							)
								patch({ bgFillMode: value });
						}}
					>
						{["cover", "contain", "center"].map((v) => (
							<option key={v} value={v}>
								{t(v)}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("playMode")}
					<select
						aria-label={t("playMode")}
						value={draft.playMode}
						onChange={(e) =>
							patch({
								playMode: e.target.value === "random" ? "random" : "sequential",
							})
						}
					>
						<option value="sequential">{t("sequential")}</option>
						<option value="random">{t("random")}</option>
					</select>
				</label>
				<label>
					{t("interval")}
					<input
						aria-label={t("interval")}
						type="number"
						min={draft.gapIntervalUnit === 0 ? 3 : 1}
						max={draft.gapIntervalUnit === 0 ? 86400 : 1440}
						value={draft.gapInterval}
						onChange={(e) => patch({ gapInterval: Number(e.target.value) })}
					/>
				</label>
				<select
					aria-label={t("unit")}
					value={draft.gapIntervalUnit}
					onChange={(e) =>
						patch({ gapIntervalUnit: e.target.value === "1" ? 1 : 0 })
					}
				>
					<option value="0">{t("seconds")}</option>
					<option value="1">{t("minutes")}</option>
				</select>
				<label className="wallpaper-sound">
					<input
						type="checkbox"
						checked={draft.enableSound}
						onChange={(e) => patch({ enableSound: e.target.checked })}
					/>
					{t("sound")}
				</label>
				<div className="button-row">
					<button type="button" className="button" onClick={() => void pick()}>
						{t("addMedia")}
					</button>
					<button
						type="button"
						className="button"
						onClick={() => patch({ displayMediaList: [] })}
					>
						{t("removeAll")}
					</button>
				</div>
				<WallpaperPlaylist
					items={draft.displayMediaList}
					disabled={busy}
					move={(from, to) =>
						patch({
							displayMediaList: reorderWallpaper(
								draft.displayMediaList,
								from,
								to,
							),
						})
					}
					remove={(index) =>
						patch({
							displayMediaList: draft.displayMediaList.filter(
								(_, i) => i !== index,
							),
						})
					}
				/>
				<div className="button-row">
					<button
						type="button"
						className="button"
						disabled={!intervalMillis(draft.gapInterval, draft.gapIntervalUnit)}
						onClick={() => void save()}
					>
						{t("save")}
					</button>
					<button
						type="button"
						className="button"
						onClick={() => {
							generation.current++;
							setDraft(initial?.settings);
							setMessage("");
						}}
					>
						{t("cancel")}
					</button>
					<button
						type="button"
						className="button"
						onClick={() => setConfirm(true)}
					>
						{t("factory")}
					</button>
				</div>
			</fieldset>
			{confirm ? (
				<div role="alertdialog" aria-label={t("factory")}>
					<p>{t("factoryConfirm")}</p>
					<button
						type="button"
						className="button"
						onClick={() => {
							setConfirm(false);
							void wallpaper.request({ _tag: "factory", ...selected });
						}}
					>
						{t("confirm")}
					</button>
					<button
						type="button"
						className="button"
						onClick={() => setConfirm(false)}
					>
						{t("cancel")}
					</button>
				</div>
			) : null}
			<p role="status">{message || wallpaper.notice}</p>
		</section>
	);
}
